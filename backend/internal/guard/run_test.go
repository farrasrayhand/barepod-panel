package guard

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeStore is the persistence the guard needs, in memory.
type fakeStore struct {
	settings Settings
	bans     map[string]Ban
	refusals []LoginRefusal
	engines  map[string]Settings
	trusted  []string
}

func newFakeStore(settings Settings) *fakeStore {
	return &fakeStore{settings: settings, bans: map[string]Ban{}}
}

func (f *fakeStore) Settings() (Settings, error)            { return f.settings, nil }
func (f *fakeStore) SaveBan(ban Ban) error                  { f.bans[ban.IP] = ban; return nil }
func (f *fakeStore) DropBan(ip string) error                { delete(f.bans, ip); return nil }
func (f *fakeStore) DropExpired(now time.Time) (int, error) { return 0, nil }
func (f *fakeStore) Bans() ([]Ban, error) {
	out := []Ban{}
	for _, ban := range f.bans {
		out = append(out, ban)
	}
	return out, nil
}

// recorder is the host side: it answers nft/docker the way the host would and remembers what
// it was asked to do.
type recorder struct {
	calls   []string
	nftOkay bool
	logs    string
}

func (r *recorder) exec(_ context.Context, name string, args ...string) (string, error) {
	line := strings.TrimSpace(name + " " + strings.Join(args, " "))
	r.calls = append(r.calls, line)
	switch {
	case name == "nft" && len(args) == 1 && args[0] == "--version":
		if !r.nftOkay {
			return "", errf("nft not found")
		}
		return "nftables v1.0.9", nil
	case name == "docker":
		return r.logs, nil
	}
	return "", nil
}

func (r *recorder) count(prefix string) int {
	n := 0
	for _, call := range r.calls {
		if strings.HasPrefix(call, prefix) {
			n++
		}
	}
	return n
}

// fixedClock is the moment the tests pretend it is. A line stamped ahead of the clock is
// deliberately ignored by Decide — a refusal that has not happened yet cannot earn a ban —
// so every fixture is built around this moment instead of around the wall clock.
var fixedClock = time.Date(2026, 10, 12, 9, 0, 0, 0, time.UTC)

func pgFailure(ip string, at time.Time) string {
	stamp := at.UTC().Format("2006-01-02 15:04:05.000")
	return stamp + " UTC [12] LOG:  connection received: host=" + ip + " port=51000\n" +
		stamp + " UTC [12] FATAL:  password authentication failed for user \"evil\"\n"
}

// mariaFailure writes the stamp the way MariaDB really does: the hour is space-padded, not
// zero-padded.
func mariaFailure(ip string, at time.Time) string {
	return at.UTC().Format("2006-01-02  3:04:05") +
		" 5 [Warning] Access denied for user 'evil'@'" + ip + "' (using password: YES)\n"
}

func mongoFailure(ip string, at time.Time) string {
	return `{"t":{"$date":"` + at.UTC().Format(time.RFC3339Nano) +
		`"},"c":"ACCESS","msg":"Authentication failed",` +
		`"attr":{"principalName":"evil","remote":"` + ip + `:51000"}}`
}

// The whole point of the offset tailer: a line is counted once. Reading the file again on the
// next pass would count the same five refusals forever, and ban everybody with a long log.
func TestSweepReadsOnlyWhatIsNewAndDoesNotCountTwice(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "postgresql-16-main.log")
	if err := os.WriteFile(path, []byte(strings.Repeat(pgFailure("203.0.113.7", fixedClock.Add(-time.Minute)), 5)), 0o640); err != nil {
		t.Fatal(err)
	}
	settings := Settings{Enabled: true, MaxRetry: 5, FindTime: 10 * time.Minute, BanTime: time.Hour}
	store := newFakeStore(settings)
	host := &recorder{nftOkay: true}
	g := NewWithSources(host.exec, store, []source{{engine: "postgresql", glob: filepath.Join(dir, "*.log")}}, time.Minute, nil)
	g.now = func() time.Time { return fixedClock }
	ctx := context.Background()

	if err := g.Sweep(ctx); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(store.bans) != 1 {
		t.Fatalf("the address that kept failing was not banned: %+v", store.bans)
	}
	ban := store.bans["203.0.113.7"]
	if ban.Count != 5 || ban.Engine != "postgresql" || !strings.Contains(ban.Reason, "5 refused logins") {
		t.Errorf("the ban does not say what it is for: %+v", ban)
	}
	if host.count("nft add element inet barepod banned { 203.0.113.7 timeout ") != 1 {
		t.Errorf("the kernel was not told, or was told twice: %v", host.calls)
	}

	// Nothing was appended, so nothing new happened — and the old failures must not be
	// re-counted into a second ban.
	before := len(host.calls)
	if err := g.Sweep(ctx); err != nil {
		t.Fatalf("second sweep: %v", err)
	}
	if len(store.bans) != 1 {
		t.Errorf("a second sweep changed the bans: %+v", store.bans)
	}
	if len(host.calls) != before {
		t.Errorf("a pass with no new lines still commanded the host: %v", host.calls[before:])
	}

	// Five more from somewhere else are seen, because the file grew.
	handle, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o640)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := handle.WriteString(strings.Repeat(pgFailure("198.51.100.9", fixedClock.Add(-time.Second)), 5)); err != nil {
		t.Fatal(err)
	}
	handle.Close()
	if err := g.Sweep(ctx); err != nil {
		t.Fatalf("third sweep: %v", err)
	}
	if _, banned := store.bans["198.51.100.9"]; !banned {
		t.Errorf("an address appended after the first pass was never seen: %v", host.calls)
	}
}

// A rotated log is smaller than what was already read; starting from the old offset would
// read from the middle of nothing and miss every line of the new file.
func TestARotatedLogIsReadFromTheStart(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "mysql.log")
	if err := os.WriteFile(path, []byte(strings.Repeat("padding line to make it long\n", 50)), 0o640); err != nil {
		t.Fatal(err)
	}
	settings := Settings{Enabled: true, MaxRetry: 1, FindTime: time.Minute, BanTime: time.Hour}
	store := newFakeStore(settings)
	host := &recorder{nftOkay: true}
	g := NewWithSources(host.exec, store, []source{{engine: "mariadb", glob: filepath.Join(dir, "*.log")}}, time.Minute, nil)
	g.now = func() time.Time { return fixedClock }
	ctx := context.Background()

	if err := g.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(mariaFailure("203.0.113.7", fixedClock.Add(-time.Minute))), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := g.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if _, banned := store.bans["203.0.113.7"]; !banned {
		t.Errorf("the rotated log was not read from its start: %v", host.calls)
	}
}

// A container has no log file. This is the source a file-reading tool cannot see, and the
// reason the watchdog exists at all.
func TestAContainerLogIsReadWithoutAFile(t *testing.T) {
	settings := Settings{Enabled: true, MaxRetry: 2, FindTime: time.Minute, BanTime: time.Hour}
	store := newFakeStore(settings)
	host := &recorder{nftOkay: true}
	host.logs = mongoFailure("203.0.113.7", fixedClock.Add(-30*time.Second)) + "\n" +
		mongoFailure("203.0.113.7", fixedClock.Add(-20*time.Second)) + "\n"
	g := NewWithSources(host.exec, store, []source{{engine: "mongodb", container: "barepod-mongo"}}, time.Minute, nil)
	g.now = func() time.Time { return fixedClock }

	if err := g.Sweep(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, banned := store.bans["203.0.113.7"]; !banned {
		t.Fatalf("a container's refusals were not read: %v", host.calls)
	}
	if host.count("docker logs --since") != 1 {
		t.Errorf("the container was not read with docker logs: %v", host.calls)
	}
}

// A restart must not let anyone back in: the addresses the panel remembers are put back into
// the kernel's set at start, and a ban that has run out is released instead.
func TestAdoptReappliesBansAcrossARestart(t *testing.T) {
	settings := Settings{Enabled: true, MaxRetry: 5, FindTime: time.Minute, BanTime: time.Hour}
	store := newFakeStore(settings)
	now := time.Now().UTC()
	store.bans["203.0.113.7"] = Ban{IP: "203.0.113.7", ExpiresAt: now.Add(30 * time.Minute)}
	store.bans["198.51.100.44"] = Ban{IP: "198.51.100.44", ExpiresAt: now.Add(-time.Minute)}
	store.bans["127.0.0.1"] = Ban{IP: "127.0.0.1", ExpiresAt: now.Add(time.Hour)}
	host := &recorder{nftOkay: true}
	g := NewWithSources(host.exec, store, nil, time.Minute, nil)

	if err := g.Adopt(context.Background()); err != nil {
		t.Fatalf("adopt: %v", err)
	}
	if host.count("nft add element inet barepod banned { 203.0.113.7 timeout ") != 1 {
		t.Errorf("a ban was not re-applied at start: %v", host.calls)
	}
	if host.count("198.51.100.44") != 0 {
		t.Errorf("an expired ban was re-applied: %v", host.calls)
	}
	if _, still := store.bans["198.51.100.44"]; still {
		t.Error("the expired ban was not released from the panel")
	}
	// Loopback is never itself banned. (The private-ports rule mentions 127.0.0.1 to let it
	// through, which is the opposite of banning it, so the check is about what is put into the
	// ban set.)
	for _, call := range host.calls {
		if strings.Contains(call, "nft add element inet barepod banned {") && strings.Contains(call, "127.") {
			t.Errorf("loopback was put into the ban set: %s", call)
		}
	}
	// The set itself is prepared before anything is put into it.
	// Exact forms: a prefix count would also match the scoped set, whose name begins the same way.
	if host.count("nft add set inet barepod banned {") != 1 ||
		host.count("nft add set inet barepod banned_port {") != 1 ||
		host.count("nft add chain inet barepod input") != 1 {
		t.Errorf("the panel's own table was not prepared: %v", host.calls)
	}
}

// The gate the exposure switch hangs on: if a ban could not be enforced, the panel must say
// so instead of looking protected.
func TestEnforcingIsHonestAboutAHostWithoutNft(t *testing.T) {
	store := newFakeStore(Defaults())
	okay := &recorder{nftOkay: true}
	if enforcing, reason := New(okay.exec, store, time.Minute, nil).Enforcing(context.Background()); !enforcing || reason != "" {
		t.Errorf("a host with nft should enforce: %v %q", enforcing, reason)
	}
	missing := &recorder{nftOkay: false}
	enforcing, reason := New(missing.exec, store, time.Minute, nil).Enforcing(context.Background())
	if enforcing || reason == "" {
		t.Errorf("a host without nft must say why: %v %q", enforcing, reason)
	}

	// Switched off is also not enforcing, and says so in those words.
	store.settings.Enabled = false
	if enforcing, reason := New(okay.exec, store, time.Minute, nil).Enforcing(context.Background()); enforcing || !strings.Contains(reason, "switched off") {
		t.Errorf("a disabled lockout must not report itself as enforcing: %v %q", enforcing, reason)
	}
}

// The operator's unban button: the address comes out of the kernel and out of the panel, and
// its failures are forgotten so it is not banned again on the next pass.
func TestUnbanReleasesAndForgets(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "mysql.log")
	if err := os.WriteFile(path, []byte(mariaFailure("203.0.113.7", fixedClock.Add(-time.Minute))), 0o640); err != nil {
		t.Fatal(err)
	}
	settings := Settings{Enabled: true, MaxRetry: 1, FindTime: 10 * time.Minute, BanTime: time.Hour}
	store := newFakeStore(settings)
	host := &recorder{nftOkay: true}
	g := NewWithSources(host.exec, store, []source{{engine: "mariadb", glob: filepath.Join(dir, "*.log")}}, time.Minute, nil)
	g.now = func() time.Time { return fixedClock }
	ctx := context.Background()

	if err := g.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if _, banned := store.bans["203.0.113.7"]; !banned {
		t.Fatal("the address was not banned first")
	}
	if err := g.Unban(ctx, "203.0.113.7"); err != nil {
		t.Fatalf("unban: %v", err)
	}
	if _, banned := store.bans["203.0.113.7"]; banned {
		t.Error("the ban was not released")
	}
	if host.count("nft delete element inet barepod banned { 203.0.113.7 }") != 1 {
		t.Errorf("the kernel was not told to let it back in: %v", host.calls)
	}
	// The refusal is still in the log but must not be re-counted: the operator has decided.
	if err := g.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if _, banned := store.bans["203.0.113.7"]; banned {
		t.Error("the address was banned again straight after being released")
	}
}

// A missing log is reported, not ignored: an engine nothing is reading has no lockout.
func TestAnAbsentLogIsReported(t *testing.T) {
	store := newFakeStore(Defaults())
	host := &recorder{nftOkay: true}
	g := NewWithSources(host.exec, store, []source{{engine: "mariadb", glob: filepath.Join(t.TempDir(), "*.log")}}, time.Minute, nil)
	if err := g.Sweep(context.Background()); err != nil {
		t.Fatal(err)
	}
	status := g.Snapshot(context.Background())
	if status.Sources["mariadb"] == "" {
		t.Errorf("a source with no log said nothing: %+v", status.Sources)
	}
}

// The panel's own refused logins, as the persistence side would hand them over.
func (f *fakeStore) LoginRefusals(afterID int64) ([]LoginRefusal, error) {
	out := []LoginRefusal{}
	for _, refusal := range f.refusals {
		if refusal.ID > afterID {
			out = append(out, refusal)
		}
	}
	return out, nil
}

func (f *fakeStore) LatestLoginRefusalID() (int64, error) {
	var highest int64
	for _, refusal := range f.refusals {
		if refusal.ID > highest {
			highest = refusal.ID
		}
	}
	return highest, nil
}

// Per-engine overrides, as the persistence side would hand them over.
func (f *fakeStore) EngineSettings() (map[string]Settings, error) {
	return f.engines, nil
}

// The addresses the lockout must never ban.
func (f *fakeStore) Trusted() ([]string, error) { return f.trusted, nil }
