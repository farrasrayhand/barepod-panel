package guard

import (
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// errf keeps the error building in this file readable.
func errf(format string, args ...any) error { return fmt.Errorf(format, args...) }

// Executor is how the guard reaches the host: the panel's runner satisfies it, and a
// dry-run runner records the command instead of running it.
type Executor func(ctx context.Context, name string, args ...string) (string, error)

// Store is the persistence the guard needs. The panel's SQLite satisfies it through a thin
// adapter, and a test satisfies it with a map.
type Store interface {
	Settings() (Settings, error)
	Bans() ([]Ban, error)
	SaveBan(Ban) error
	DropBan(ip string) error
	DropExpired(now time.Time) (int, error)
}

// source is one place refusals are written. A host engine writes a file (PostgreSQL and
// MariaDB); the panel's MongoDB is a container, whose log is not a file at all and is read with
// `docker logs` — the case a file-reading tool cannot handle. Redis writes no refusals anywhere,
// so its source is Redis's own ACL LOG, read through the client (`acl`).
type source struct {
	engine    string
	glob      string
	container string
	acl       bool
}

// Sources lists where the guard looks. A source that is not there is reported rather than
// silently skipped: an engine whose log nothing is reading is an engine with no lockout.
func Sources() []source {
	return []source{
		{engine: "postgresql", glob: "/var/log/postgresql/postgresql-*.log"},
		{engine: "mariadb", glob: "/var/log/mysql/*.log"},
		{engine: "mongodb", container: "barepod-mongo"},
		{engine: "redis", acl: true},
	}
}

// firstReadBytes caps how much of a pre-existing log is examined when the guard starts. A
// ban is for an attack happening now; replaying a year of history on boot would be a real
// read for no protection, and would ban addresses that stopped long ago.
const firstReadBytes = 256 << 10

// Guard reads the engines' refusals and keeps the addresses that keep trying out of them.
type Guard struct {
	exec     Executor
	store    Store
	sources  []source
	now      func() time.Time
	logf     func(string, ...any)
	interval time.Duration

	mu         sync.Mutex
	offsets    map[string]int64
	since      map[string]time.Time
	window     []Failure
	lastSweep  time.Time
	lastError  string
	sourceNote map[string]string
	// redisURL is the panel's own Redis identity, needed because ACL LOG can only be read by
	// someone authenticated. Empty means the cache's refusals cannot be read, and the status says so.
	redisURL string
}

// UseRedisACL tells the guard how to read the cache's refusals. It is a setter rather than a
// constructor argument because a panel without a cache is a normal case and its guard should still
// work, unchanged.
func (g *Guard) UseRedisACL(url string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.redisURL = url
}

// New builds a guard over the usual sources. interval is how often it looks; zero means
// every fifteen seconds, which is often enough that an attacker cannot get far between two
// looks and rare enough that the read is invisible.
func New(exec Executor, store Store, interval time.Duration, logf func(string, ...any)) *Guard {
	return NewWithSources(exec, store, Sources(), interval, logf)
}

// NewWithSources is New with the log sources named, so a test can point them at a file it
// controls rather than at the host's own logs.
func NewWithSources(exec Executor, store Store, sources []source, interval time.Duration, logf func(string, ...any)) *Guard {
	if interval <= 0 {
		interval = 15 * time.Second
	}
	if logf == nil {
		logf = func(string, ...any) {}
	}
	return &Guard{
		exec:       exec,
		store:      store,
		sources:    sources,
		now:        func() time.Time { return time.Now().UTC() },
		logf:       logf,
		interval:   interval,
		offsets:    map[string]int64{},
		since:      map[string]time.Time{},
		sourceNote: map[string]string{},
	}
}

// Adopt prepares the kernel's side of the guard and re-applies every ban the panel remembers.
// This is what makes a restart harmless: the addresses kept out before it are kept out after
// it, from the table rather than from re-reading logs.
func (g *Guard) Adopt(ctx context.Context) error {
	for _, argv := range EnsureArgv() {
		if out, err := g.exec(ctx, argv[0], argv[1:]...); err != nil {
			return errf("prepare %s: %s (%v)", strings.Join(argv, " "), strings.TrimSpace(out), err)
		}
	}
	// The addresses that may still reach a private port: loopback, and the docker bridge. The
	// bridge is not optional — the panel hands its own containerised manager the bridge gateway
	// to reach a containerised engine (DbGate to MongoDB), so dropping the bridge would take that
	// away. It is discovered rather than assumed: a host's LAN can sit in the same private range
	// as docker's default (this host: LAN 172.19.1.0/24, bridge 172.17.0.0/16).
	for _, cidr := range append([]string{"127.0.0.0/8"}, g.bridgeSubnets(ctx)...) {
		argv := ExemptArgv(cidr)
		if out, err := g.exec(ctx, argv[0], argv[1:]...); err != nil {
			// Already present is not a failure: Adopt runs on every start.
			if !strings.Contains(out, "File exists") {
				g.logf("guard: %s could not be exempted: %s (%v)", cidr, strings.TrimSpace(out), err)
			}
		}
	}
	bans, err := g.store.Bans()
	if err != nil {
		return err
	}
	now := g.now()
	reapplied, released := 0, 0
	for _, ban := range bans {
		if isLoopback(ban.IP) || IsTrusted(ban.IP) {
			continue
		}
		if !ban.ExpiresAt.After(now) {
			_ = g.store.DropBan(ban.IP)
			released++
			continue
		}
		argv := BanArgv(ban)
		if out, err := g.exec(ctx, argv[0], argv[1:]...); err != nil {
			g.logf("guard: re-applying the ban on %s failed: %s (%v)", ban.IP, strings.TrimSpace(out), err)
			continue
		}
		reapplied++
	}
	g.logf("guard: %d ban(s) re-applied from the panel, %d expired released", reapplied, released)
	return nil
}

// Run prepares the kernel side and then looks at the logs on a fixed interval until the
// context is cancelled.
func (g *Guard) Run(ctx context.Context) {
	if err := g.Adopt(ctx); err != nil {
		// Not fatal: a panel that cannot reach nft must still serve, and Status says so.
		g.note(err.Error())
	}
	ticker := time.NewTicker(g.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := g.Sweep(ctx); err != nil {
				g.note(err.Error())
			}
		}
	}
}

// Sweep does one pass: read what is new in the logs, decide, and tell the kernel.
func (g *Guard) Sweep(ctx context.Context) error {
	settings, err := g.store.Settings()
	if err != nil {
		return err
	}
	now := g.now()

	// Reading happens outside the lock: the readers take it themselves to record their
	// offsets, and holding it across them would deadlock the guard against itself.
	failures := g.collect(ctx, now)
	if len(failures) > 0 {
		// Only when something was actually read: a line per pass would be noise, and silence
		// while refusals are arriving is what makes a lockout impossible to diagnose.
		g.logf("guard: read %d refusal(s) from the engines' logs", len(failures))
	}

	g.mu.Lock()
	// The window is pruned on every pass, so it cannot grow without bound: only the
	// failures still inside findtime are kept, which is all the decision needs.
	keep := g.window[:0]
	for _, failure := range g.window {
		if now.Sub(failure.At) <= settings.FindTime {
			keep = append(keep, failure)
		}
	}
	g.window = append(keep, failures...)
	window := append([]Failure(nil), g.window...)
	g.mu.Unlock()

	existing := map[string]Ban{}
	bans, err := g.store.Bans()
	if err != nil {
		return err
	}
	for _, ban := range bans {
		existing[ban.IP] = ban
	}

	ban, drop := Decide(settings, window, existing, now)

	var firstErr error
	banned := 0
	for _, entry := range ban {
		argv := BanArgv(entry)
		if out, err := g.exec(ctx, argv[0], argv[1:]...); err != nil {
			if firstErr == nil {
				firstErr = errf("ban %s: %s (%v)", entry.IP, strings.TrimSpace(out), err)
			}
			continue
		}
		if err := g.store.SaveBan(entry); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		// The address is out, and its failures need not be counted again: drop them so a
		// re-ban after release starts from a clean window.
		g.forget(entry.IP)
		banned++
		g.logf("guard: banned %s for %s (%s)", entry.IP, settings.BanTime, entry.Reason)
	}
	for _, ip := range drop {
		argv := UnbanArgv(ip)
		if out, err := g.exec(ctx, argv[0], argv[1:]...); err != nil {
			// The kernel may have expired the element itself, which is a success.
			if !strings.Contains(out, "No such file or directory") && !strings.Contains(out, "does not exist") {
				if firstErr == nil {
					firstErr = errf("release %s: %s (%v)", ip, strings.TrimSpace(out), err)
				}
				continue
			}
		}
		_ = g.store.DropBan(ip)
		g.logf("guard: released %s, its ban had run out", ip)
	}
	if released, err := g.store.DropExpired(now); err == nil && released > 0 {
		g.logf("guard: dropped %d expired ban record(s)", released)
	}

	g.mu.Lock()
	g.lastSweep = now
	if firstErr != nil {
		g.lastError = firstErr.Error()
	} else {
		g.lastError = ""
	}
	g.mu.Unlock()
	return firstErr
}

// bridgeSubnets asks the host which networks its docker bridges carry, so their addresses can be
// exempt without exempting whatever else shares that private range.
func (g *Guard) bridgeSubnets(ctx context.Context) []string {
	out, err := g.exec(ctx, "ip", "-4", "-o", "addr", "show")
	if err != nil {
		return nil
	}
	subnets := []string{}
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 || !strings.HasPrefix(fields[1], "docker") {
			continue
		}
		_, network, err := net.ParseCIDR(fields[3])
		if err != nil {
			continue
		}
		subnets = append(subnets, network.String())
	}
	return subnets
}

// readRedisACL asks Redis for its own record of recent ACL failures, and clears it afterwards.
//
// The reset is what makes this exact: entries stay in Redis until something removes them, so a
// sweep that read without resetting would count the same refusal on every pass and ban an address
// that had tried once. Clearing it after reading is the equivalent of the byte offset the file
// sources keep.
//
// ACL LOG can only be read by an authenticated client, so the panel's own identity travels in the
// argument list — the same way the panel creates a cache user.
func (g *Guard) readRedisACL(ctx context.Context) (string, error) {
	g.mu.Lock()
	url := g.redisURL
	g.mu.Unlock()
	if url == "" {
		return "", errf("no Redis admin connection is configured, so the cache's refusals cannot be read")
	}
	out, err := g.exec(ctx, "redis-cli", "-u", url, "--no-auth-warning", "ACL", "LOG", "128")
	if err != nil {
		return "", errf("ACL LOG could not be read: %s", strings.TrimSpace(out))
	}
	if _, err := g.exec(ctx, "redis-cli", "-u", url, "--no-auth-warning", "ACL", "LOG", "RESET"); err != nil {
		// Not fatal — the refusals were read — but saying so explains a later double count.
		g.logf("guard: the cache's ACL log could not be cleared, so an entry may be counted twice")
	}
	return out, nil
}

// Unban releases one address at once — the button in the panel — and also forgets its
// failures, so it is not banned again the moment the operator lets it back in.
func (g *Guard) Unban(ctx context.Context, ip string) error {
	argv := UnbanArgv(ip)
	if out, err := g.exec(ctx, argv[0], argv[1:]...); err != nil {
		if !strings.Contains(out, "No such file or directory") && !strings.Contains(out, "does not exist") {
			return errf("release %s: %s (%v)", ip, strings.TrimSpace(out), err)
		}
	}
	g.forget(ip)
	return g.store.DropBan(ip)
}

// collect reads whatever is new in every source and turns it into failures.
func (g *Guard) collect(ctx context.Context, now time.Time) []Failure {
	out := []Failure{}
	for _, src := range g.sources {
		switch {
		case src.acl:
			text, err := g.readRedisACL(ctx)
			if err != nil {
				g.noteSource(src.engine, err.Error())
				continue
			}
			g.noteSource(src.engine, "")
			out = append(out, stampReadTime(Scan(src.engine, text), now)...)
		case src.container != "":
			text, err := g.containerLog(ctx, src, now)
			if err != nil {
				g.noteSource(src.engine, err.Error())
				continue
			}
			g.noteSource(src.engine, "")
			out = append(out, stampReadTime(Scan(src.engine, text), now)...)
		default:
			_, text, err := g.fileDelta(src)
			if err != nil {
				g.noteSource(src.engine, err.Error())
				continue
			}
			g.noteSource(src.engine, "")
			out = append(out, stampReadTime(Scan(src.engine, text), now)...)
		}
	}
	return out
}

// fileDelta reads only what has been appended since the last look, and starts from the tail
// of a log it has never seen before.
func (g *Guard) fileDelta(src source) (string, string, error) {
	path := newestMatch(src.glob)
	if path == "" {
		return "", "", errf("no log file at %s — nothing would be watched (configure the engine to log to a file)", src.glob)
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", "", err
	}
	size := info.Size()

	g.mu.Lock()
	offset := g.offsets[path]
	g.mu.Unlock()

	// A file smaller than what was already read was rotated or truncated: start again.
	if size < offset {
		offset = 0
	}
	start := offset
	if start == 0 {
		// Never seen: read the tail, not the whole history.
		start = size - firstReadBytes
		if start < 0 {
			start = 0
		}
	}
	if size == start {
		return path, "", nil
	}
	handle, err := os.Open(path)
	if err != nil {
		return "", "", err
	}
	defer handle.Close()
	if _, err := handle.Seek(start, io.SeekStart); err != nil {
		return "", "", err
	}
	// A cap on every pass, so one enormous burst cannot turn into one enormous allocation.
	text, err := io.ReadAll(io.LimitReader(handle, 4<<20))
	if err != nil {
		return "", "", err
	}
	g.mu.Lock()
	g.offsets[path] = size
	g.mu.Unlock()
	return path, string(text), nil
}

// containerLog reads a container's log, which is not a file: the panel's MongoDB writes to
// `docker logs`, so this is the source a file-reading tool would never see.
func (g *Guard) containerLog(ctx context.Context, src source, now time.Time) (string, error) {
	g.mu.Lock()
	since := g.since[src.container]
	g.mu.Unlock()
	if since.IsZero() {
		// First look: only the near past, for the same reason the tail cap exists.
		since = now.Add(-5 * time.Minute)
	}
	argv := []string{"logs", "--since", since.UTC().Format(time.RFC3339), "--tail", "2000", src.container}
	out, err := g.exec(ctx, "docker", argv...)
	if err != nil {
		return "", errf("docker %s: %s (%v)", strings.Join(argv, " "), strings.TrimSpace(out), err)
	}
	g.mu.Lock()
	g.since[src.container] = now
	g.mu.Unlock()
	return out, nil
}

// Enforcing answers whether an address can actually be kept out right now, and why not when
// it cannot. Opening a database port hangs on this: a lockout that is configured but not
// running is worse than none, because it looks like protection.
func (g *Guard) Enforcing(ctx context.Context) (bool, string) {
	settings, err := g.store.Settings()
	if err != nil {
		return false, "the lockout settings could not be read"
	}
	if !settings.Enabled {
		return false, "the lockout is switched off"
	}
	if _, err := g.exec(ctx, "nft", "--version"); err != nil {
		return false, "nft is not available on this host, so a ban could not be enforced"
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.lastSweep.IsZero() && g.lastError != "" {
		return false, "the last check failed: " + g.lastError
	}
	return true, ""
}

// Status is what the panel shows about the lockout.
type Status struct {
	Enabled   bool              `json:"enabled"`
	MaxRetry  int               `json:"maxRetry"`
	FindTime  string            `json:"findTime"`
	BanTime   string            `json:"banTime"`
	Enforcing bool              `json:"enforcing"`
	Reason    string            `json:"reason,omitempty"`
	Bans      []Ban             `json:"bans"`
	Sources   map[string]string `json:"sources"`
	LastSweep string            `json:"lastSweep,omitempty"`
	LastError string            `json:"lastError,omitempty"`
	Interval  string            `json:"interval"`
	Table     string            `json:"table"`
	Set       string            `json:"set"`
}

// Snapshot reports the lockout's settings, its bans and whether it is really enforcing.
func (g *Guard) Snapshot(ctx context.Context) Status {
	settings, _ := g.store.Settings()
	bans, _ := g.store.Bans()
	enforcing, reason := g.Enforcing(ctx)
	if bans == nil {
		bans = []Ban{}
	}
	g.mu.Lock()
	sources := map[string]string{}
	for engine, note := range g.sourceNote {
		sources[engine] = note
	}
	lastSweep, lastError := g.lastSweep, g.lastError
	g.mu.Unlock()
	out := Status{
		Enabled:   settings.Enabled,
		MaxRetry:  settings.MaxRetry,
		FindTime:  settings.FindTime.String(),
		BanTime:   settings.BanTime.String(),
		Enforcing: enforcing,
		Reason:    reason,
		Bans:      bans,
		Sources:   sources,
		LastError: lastError,
		Interval:  g.interval.String(),
		Table:     Table,
		Set:       Set,
	}
	if !lastSweep.IsZero() {
		out.LastSweep = lastSweep.Format(time.RFC3339)
	}
	return out
}

func (g *Guard) forget(ip string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	keep := g.window[:0]
	for _, failure := range g.window {
		if failure.IP != ip {
			keep = append(keep, failure)
		}
	}
	g.window = keep
}

func (g *Guard) note(message string) {
	g.mu.Lock()
	g.lastError = message
	g.mu.Unlock()
	g.logf("guard: %s", message)
}

func (g *Guard) noteSource(engine, note string) {
	g.mu.Lock()
	g.sourceNote[engine] = note
	g.mu.Unlock()
}

// stampReadTime marks every refusal with the moment the panel read it, rather than with the
// engine's own timestamp. Engines stamp in their own timezone — this host's PostgreSQL writes
// "Asia/Makassar", eight hours from the panel's clock — and a stamp read at face value can
// land outside the window, silently letting a real attack pass. The tailer reads only what
// was just appended, so the read time is within one interval of when it happened.
func stampReadTime(failures []Failure, now time.Time) []Failure {
	for i := range failures {
		failures[i].At = now
	}
	return failures
}

// newestMatch picks the newest file a glob matches: PostgreSQL names its log after the
// version, so the path is not knowable in advance.
func newestMatch(pattern string) string {
	matches, err := filepath.Glob(pattern)
	if err != nil || len(matches) == 0 {
		return ""
	}
	newest, newestAt := matches[0], time.Time{}
	for _, match := range matches {
		info, err := os.Stat(match)
		if err != nil {
			continue
		}
		if info.ModTime().After(newestAt) {
			newest, newestAt = match, info.ModTime()
		}
	}
	return newest
}
