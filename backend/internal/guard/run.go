package guard

import (
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
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
	// LoginRefusals are the panel's *own* refused logins, newer than an audit id. They are a source
	// like any log: the panel had none, so an attempt against the panel itself was invisible.
	LoginRefusals(afterID int64) ([]LoginRefusal, error)
	// LatestLoginRefusalID is where to start counting from.
	LatestLoginRefusalID() (int64, error)
	// EngineSettings are the per-engine overrides. An engine with no entry uses the default.
	EngineSettings() (map[string]Settings, error)
	// Trusted is the addresses the lockout must never ban: the places the operator administers the
	// panel from. A ban that includes one of those takes away the way back in.
	Trusted() ([]string, error)
}

// LoginRefusal is one refused login to the panel, as the audit trail records it.
type LoginRefusal struct {
	ID     int64
	At     time.Time
	IP     string
	User   string
	Detail string
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
	panel     bool
	// journal reads a unit's journal instead of a file. SSH writes no log the panel can read on every
	// distribution, and its refusals are exactly what a lockout needs.
	journal string
}

// Sources lists where the guard looks. A source that is not there is reported rather than
// silently skipped: an engine whose log nothing is reading is an engine with no lockout.
func Sources() []source {
	return []source{
		{engine: "postgresql", glob: "/var/log/postgresql/postgresql-*.log"},
		{engine: "mariadb", glob: "/var/log/mysql/*.log"},
		{engine: "mongodb", container: "barepod-mongo"},
		{engine: "redis", acl: true},
		// The panel's own door. It is not a file and not a container: the daemon already records
		// every refused login, with the address it came from, and this reads those records.
		{engine: "panel", panel: true},
		{engine: "ssh", journal: "ssh"},
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
	// scopes say which door a ban earned on an engine closes: 0 is the whole host, a port is that
	// door only. The panel and SSH close their own door, so tripping either never removes the way back
	// in; an engine's ban is host-wide, because an address attacking a database has no business
	// reaching anything else either.
	scopes map[string][]int
	// redisURL is the panel's own Redis identity, needed because ACL LOG can only be read by
	// someone authenticated. Empty means the cache's refusals cannot be read, and the status says so.
	redisURL string
	// refusalMark is the last panel login refusal counted, and refusalStarted says whether the
	// high-water mark has been taken yet — the first read takes it rather than the history.
	refusalMark    int64
	refusalStarted bool
}

// UseRedisACL tells the guard how to read the cache's refusals. It is a setter rather than a
// constructor argument because a panel without a cache is a normal case and its guard should still
// work, unchanged.
// SetScopes tells the guard which doors an engine's bans close: the panel's own port, from how the
// daemon was started.
func (g *Guard) SetScopes(scopes map[string][]int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.scopes == nil {
		g.scopes = map[string][]int{}
	}
	for engine, ports := range scopes {
		g.scopes[engine] = ports
	}
}

// refreshScopes re-reads the doors that can change while the daemon runs. SSH's port lives in its own
// configuration and can be changed from the panel, so reading it once at start meant a ban closing a
// port sshd had stopped listening on — a door closed where nobody was knocking, and a new one open.
func (g *Guard) refreshScopes() {
	// Every port sshd is configured for, not the first one: while its port is being moved it answers on
	// two, and a scope that covered one of them would leave the other open to the same attacker.
	ports := sshPortsFromConfig()
	g.mu.Lock()
	if g.scopes == nil {
		g.scopes = map[string][]int{}
	}
	g.scopes["ssh"] = ports
	g.mu.Unlock()
}

func (g *Guard) scopePorts(engine string) []int {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.scopes[engine]
}

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
		failed := false
		for _, argv := range BanArgv(ban) {
			if out, err := g.exec(ctx, argv[0], argv[1:]...); err != nil {
				g.logf("guard: re-applying the ban on %s failed: %s (%v)", ban.IP, strings.TrimSpace(out), err)
				failed = true
			}
		}
		if failed {
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
	// Per-engine overrides: a cache asked for a password ten times a second and a panel login are not
	// the same risk, so each engine may carry its own numbers.
	perEngine, err := g.store.EngineSettings()
	if err != nil {
		return err
	}
	// The doors that can move while the daemon runs, re-read before anything is decided.
	g.refreshScopes()
	// Refreshed every sweep, so an address that has just proved it is the operator's is exempt from
	// the pass that follows. Decide consults it (IsTrusted); nothing else writes it.
	if trusted, err := g.store.Trusted(); err == nil {
		Trusted = trusted
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
	// Pruned with the widest window any engine uses, so an engine with a longer window is not robbed
	// of its own history; Decide then applies each engine's window.
	keep := g.window[:0]
	window := widestFindTime(settings, perEngine)
	for _, failure := range g.window {
		if now.Sub(failure.At) <= window {
			keep = append(keep, failure)
		}
	}
	g.window = append(keep, failures...)
	kept := append([]Failure(nil), g.window...)
	g.mu.Unlock()

	existing := map[string]Ban{}
	bans, err := g.store.Bans()
	if err != nil {
		return err
	}
	for _, ban := range bans {
		existing[ban.IP] = ban
	}

	ban, drop := Decide(settings, perEngine, kept, existing, now)

	var firstErr error
	banned := 0
	for i := range ban {
		// The door this ban closes, decided by the engine that earned it.
		ban[i].Ports = g.scopePorts(ban[i].Engine)
	}
	for _, entry := range ban {
		banFailed := false
		for _, argv := range BanArgv(entry) {
			if out, err := g.exec(ctx, argv[0], argv[1:]...); err != nil {
				if firstErr == nil {
					firstErr = errf("ban %s: %s (%v)", entry.IP, strings.TrimSpace(out), err)
				}
				banFailed = true
			}
		}
		if banFailed {
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
		// The recorded scope, so a ban that closed those doors is released from those doors.
		for _, argv := range UnbanBanArgv(existing[ip]) {
			if out, err := g.exec(ctx, argv[0], argv[1:]...); err != nil {
				// The kernel may have expired the element itself, which is a success.
				if !strings.Contains(out, "No such file or directory") && !strings.Contains(out, "does not exist") {
					if firstErr == nil {
						firstErr = errf("release %s: %s (%v)", ip, strings.TrimSpace(out), err)
					}
				}
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

// journalLog reads a unit's journal since the last look, the way the container source reads docker
// logs: a journal has no byte offset, so the time of the previous read is the mark.
func (g *Guard) journalLog(ctx context.Context, src source, now time.Time) (string, error) {
	g.mu.Lock()
	since := g.since["journal:"+src.journal]
	g.mu.Unlock()
	if since.IsZero() {
		since = now.Add(-5 * time.Minute)
	}
	// -o cat keeps only the message, which is the part with the refusal in it.
	out, err := g.exec(ctx, "journalctl", "-u", src.journal, "--since", since.UTC().Format("2006-01-02 15:04:05"),
		"--no-pager", "-o", "cat")
	if err != nil {
		return "", errf("journalctl -u %s: %s (%v)", src.journal, strings.TrimSpace(out), err)
	}
	g.mu.Lock()
	g.since["journal:"+src.journal] = now
	g.mu.Unlock()
	return out, nil
}

// panelRefusals reads the panel's own refused logins since the last one counted. The first read
// takes the high-water mark instead of the history: replaying a long audit trail would ban addresses
// that stopped long ago, which is the same reason the file sources start at the end of their file.
func (g *Guard) panelRefusals() ([]LoginRefusal, error) {
	g.mu.Lock()
	after, started := g.refusalMark, g.refusalStarted
	g.mu.Unlock()
	if !started {
		mark, err := g.store.LatestLoginRefusalID()
		if err != nil {
			return nil, err
		}
		g.mu.Lock()
		g.refusalMark, g.refusalStarted = mark, true
		g.mu.Unlock()
		return nil, nil
	}
	refusals, err := g.store.LoginRefusals(after)
	if err != nil {
		return nil, err
	}
	if len(refusals) > 0 {
		g.mu.Lock()
		g.refusalMark = refusals[len(refusals)-1].ID
		g.mu.Unlock()
	}
	return refusals, nil
}

// Unban releases one address at once — the button in the panel — and also forgets its
// failures, so it is not banned again the moment the operator lets it back in.
func (g *Guard) Unban(ctx context.Context, ip string) error {
	// Through the door it was kept out of: the same address can be banned host-wide by an engine and
	// on one port by the panel, and releasing it has to release both.
	held, err := g.store.Bans()
	if err != nil {
		return err
	}
	removed := false
	for _, ban := range held {
		if ban.IP != ip {
			continue
		}
		removed = true
		for _, argv := range UnbanBanArgv(ban) {
			if out, err := g.exec(ctx, argv[0], argv[1:]...); err != nil {
				if !strings.Contains(out, "No such file or directory") && !strings.Contains(out, "does not exist") {
					return errf("release %s: %s (%v)", ip, strings.TrimSpace(out), err)
				}
			}
		}
	}
	if !removed {
		// Nothing recorded: still try the host-wide set, which is where an old ban lived.
		argv := UnbanArgv(ip)
		_, _ = g.exec(ctx, argv[0], argv[1:]...)
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
		case src.journal != "":
			text, err := g.journalLog(ctx, src, now)
			if err != nil {
				g.noteSource(src.engine, err.Error())
				continue
			}
			g.noteSource(src.engine, "")
			out = append(out, stampReadTime(Scan(src.engine, text), now)...)
		case src.panel:
			refusals, err := g.panelRefusals()
			if err != nil {
				g.noteSource(src.engine, err.Error())
				continue
			}
			g.noteSource(src.engine, "")
			for _, refusal := range refusals {
				if refusal.IP == "" {
					continue
				}
				out = append(out, Failure{Engine: "panel", IP: refusal.IP, User: refusal.User, At: now})
			}
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

// EngineNumbers is one engine's own numbers, as the screen shows and edits them. Override says
// whether they are the engine's or the default's, so a screen can say which it is looking at.
type EngineNumbers struct {
	MaxRetry int    `json:"maxRetry"`
	FindTime string `json:"findTime"`
	BanTime  string `json:"banTime"`
	Override bool   `json:"override"`
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
	// Engines carries every engine the lockout reads, with the numbers it would use for it — its own
	// if it has any, the default otherwise. These are edited in Panel Settings → Security and nowhere
	// else: a lockout a tenant could loosen is not a lockout.
	Engines map[string]EngineNumbers `json:"engines"`
}

// Snapshot reports the lockout's settings, its bans and whether it is really enforcing.
func (g *Guard) Snapshot(ctx context.Context) Status {
	settings, _ := g.store.Settings()
	bans, _ := g.store.Bans()
	enforcing, reason := g.Enforcing(ctx)
	if bans == nil {
		bans = []Ban{}
	}
	perEngine, _ := g.store.EngineSettings()
	engines := map[string]EngineNumbers{}
	for _, src := range g.sources {
		numbers := settings
		override := false
		if custom, found := perEngine[src.engine]; found {
			numbers, override = custom, true
		}
		engines[src.engine] = EngineNumbers{
			MaxRetry: numbers.MaxRetry, FindTime: numbers.FindTime.String(),
			BanTime: numbers.BanTime.String(), Override: override,
		}
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
		Engines:   engines,
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

// widestFindTime is the longest window in use, which is what a shared buffer has to survive.
func widestFindTime(fallback Settings, perEngine map[string]Settings) time.Duration {
	widest := fallback.FindTime
	for _, settings := range perEngine {
		if settings.FindTime > widest {
			widest = settings.FindTime
		}
	}
	return widest
}

// sshPortsFromConfig reads every port sshd was told to listen on, or the documented default when it was
// told nothing, which is what this host does.
func sshPortsFromConfig() []int {
	body, err := os.ReadFile("/etc/ssh/sshd_config")
	if err != nil {
		return []int{22}
	}
	ports := []int{}
	for _, line := range strings.Split(string(body), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && strings.EqualFold(fields[0], "Port") {
			if port, err := strconv.Atoi(fields[1]); err == nil {
				ports = append(ports, port)
			}
		}
	}
	if len(ports) == 0 {
		return []int{22}
	}
	return ports
}
