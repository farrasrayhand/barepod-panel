package guard

import (
	"strings"
	"testing"
	"time"
)

// PostgreSQL writes the peer address on the connection line and the refusal on a later line
// carrying the same session pid. A single-line filter cannot see both, which is why the pair
// is joined here — and why a refusal whose connection was never seen is *not* blamed on
// whichever address connected last.
func TestPostgresRefusalsArePairedWithTheirPeerByPid(t *testing.T) {
	log := strings.Join([]string{
		`2026-10-12 09:00:00.000 UTC [123] LOG:  connection received: host=203.0.113.7 port=51000`,
		`2026-10-12 09:00:00.010 UTC [123] FATAL:  password authentication failed for user "evil"`,
		`2026-10-12 09:00:01.000 UTC [124] LOG:  connection received: host=198.51.100.9 port=51001`,
		`2026-10-12 09:00:01.010 UTC [124] FATAL:  no pg_hba.conf entry for host "198.51.100.9", user "shop", database "shop"`,
		`2026-10-12 09:00:02.000 UTC [125] FATAL:  password authentication failed for user "nameless"`,
	}, "\n")

	got := Scan("postgresql", log)
	if len(got) != 2 {
		t.Fatalf("want two refusals with a known peer, got %d: %+v", len(got), got)
	}
	if got[0].IP != "203.0.113.7" || got[0].User != "evil" || got[0].Engine != "postgresql" {
		t.Errorf("first refusal is wrong: %+v", got[0])
	}
	if got[1].IP != "198.51.100.9" {
		t.Errorf("second refusal lost its peer: %+v", got[1])
	}
}

func TestMariaDBRefusalCarriesTheAddress(t *testing.T) {
	log := `2026-10-12  9:00:00 5 [Warning] Access denied for user 'evil'@'203.0.113.7' (using password: YES)`
	got := Scan("mariadb", log)
	if len(got) != 1 || got[0].IP != "203.0.113.7" || got[0].User != "evil" {
		t.Fatalf("MariaDB refusal not read: %+v", got)
	}
	// No time is taken from the engine's stamp: MariaDB writes the hour space-padded and in
	// its own timezone, and the caller stamps the moment it read the line instead.
	if !got[0].At.IsZero() {
		t.Errorf("Scan should record no time of its own: %+v", got[0])
	}
}

// Measured on the host: Redis logs no refusals at all (zero lines, loglevel notice), and its ACL
// LOG prints each entry field by field with the peer inside client-info. Only an `auth` refusal is
// a refusal to keep somebody out — a `key` entry is a tenant reaching past the prefix the panel
// itself scoped, and banning that address would punish the application it just constrained.
func TestRedisRefusalsComeFromTheACLLogAndOnlyForAuthentication(t *testing.T) {
	log := strings.Join([]string{
		"count", "1", "reason", "auth", "context", "toplevel", "object", "AUTH",
		"username", "nobody-here", "age-seconds", "0.008", "client-info",
		"id=241 addr=203.0.113.7:51606 laddr=127.0.0.1:6379 fd=10 name= age=0 idle=0 flags=N",
		"count", "4", "reason", "key", "context", "toplevel", "object", "admin_diag_cache:halo",
		"username", "admin_diag_cache", "age-seconds", "408.101", "client-info",
		"id=240 addr=198.51.100.9:51594 frag=0 capacity=64",
	}, "\n")
	got := Scan("redis", log)
	if len(got) != 1 {
		t.Fatalf("want the one authentication refusal and no key refusal, got %+v", got)
	}
	if got[0].IP != "203.0.113.7" || got[0].User != "nobody-here" || got[0].Engine != "redis" {
		t.Errorf("the refusal was not read as written: %+v", got[0])
	}
}

// The messages the engines write are read as they are; a probe that asks for credentials is a
// server that answered.
func TestRediRefusalsWithNoPeerAreSkipped(t *testing.T) {
	log := strings.Join([]string{"count", "2", "reason", "auth", "object", "AUTH", "username", "evil", "client-info", "id=9 frag=0"}, "\n")
	if got := Scan("redis", log); len(got) != 0 {
		t.Errorf("a refusal naming no address was attributed anyway: %+v", got)
	}
}

// Measured on the test host: a server with log_connections off writes the refusal with no
// address anywhere (the "connection received" line does not exist at all). Such a refusal
// cannot be attributed, and blaming it on the last connection seen would ban an innocent
// address — so it is skipped.
func TestARefusalWithNoAddressIsSkipped(t *testing.T) {
	log := `2026-10-11 21:47:01.460 WITA [57579] root@admin_reports_db FATAL:  password authentication failed for user "root"`
	if got := Scan("postgresql", log); len(got) != 0 {
		t.Errorf("a refusal naming no address was attributed anyway: %+v", got)
	}
}

// The other shape, for an installation whose log_line_prefix carries the host (`%h`): the
// refusal names its own peer and needs no pairing.
func TestARefusalThatNamesItsOwnHostIsRead(t *testing.T) {
	log := `2026-10-12 09:00:00.010 UTC [123] evil@shop 203.0.113.7 host=198.51.100.9 FATAL:  password authentication failed for user "evil"`
	got := Scan("postgresql", log)
	if len(got) != 1 || got[0].IP != "198.51.100.9" || got[0].User != "evil" {
		t.Fatalf("a refusal carrying its own peer was not read: %+v", got)
	}
}

// The panel's MongoDB is a container: its log is JSON, which is exactly what a
// file-reading tool cannot see and this can.
func TestMongoContainerLogIsReadable(t *testing.T) {
	log := `{"t":{"$date":"2026-10-12T09:00:00.000+00:00"},"s":"I","c":"ACCESS","id":5286306,"ctx":"conn12",` +
		`"msg":"Authentication failed","attr":{"mechanism":"SCRAM-SHA-256","principalName":"evil",` +
		`"authenticationDatabase":"admin","remote":"203.0.113.7:51000"}}`
	got := Scan("mongodb", log)
	if len(got) != 1 || got[0].IP != "203.0.113.7" || got[0].User != "evil" {
		t.Fatalf("MongoDB refusal not read: %+v", got)
	}
}

func TestDecideCountsInsideTheWindowAndNeverBansLoopback(t *testing.T) {
	settings := Settings{Enabled: true, MaxRetry: 3, FindTime: 10 * time.Minute, BanTime: time.Hour}
	now := time.Date(2026, 10, 12, 9, 0, 0, 0, time.UTC)
	failures := []Failure{
		{Engine: "postgresql", IP: "203.0.113.7", At: now.Add(-time.Minute)},
		{Engine: "postgresql", IP: "203.0.113.7", At: now.Add(-30 * time.Second)},
		{Engine: "postgresql", IP: "203.0.113.7", At: now.Add(-time.Second)},
		// loopback: how the panel itself connects, so it can never earn a ban
		{Engine: "postgresql", IP: "127.0.0.1", At: now},
		{Engine: "postgresql", IP: "127.0.0.1", At: now},
		{Engine: "postgresql", IP: "127.0.0.1", At: now},
		// too old to count
		{Engine: "mariadb", IP: "198.51.100.9", At: now.Add(-time.Hour)},
	}

	ban, drop := Decide(settings, nil, failures, nil, now)
	if len(ban) != 1 || ban[0].IP != "203.0.113.7" {
		t.Fatalf("the address that kept trying was not banned: %+v", ban)
	}
	if ban[0].Count != 3 || !ban[0].ExpiresAt.Equal(now.Add(time.Hour)) {
		t.Errorf("the ban does not carry its count and expiry: %+v", ban[0])
	}
	if len(drop) != 0 {
		t.Errorf("nothing should be dropped yet: %v", drop)
	}

	// An address already banned is not banned twice, and one whose ban has run out is let go.
	existing := map[string]Ban{
		"203.0.113.7":   {IP: "203.0.113.7", ExpiresAt: now.Add(time.Minute)},
		"198.51.100.44": {IP: "198.51.100.44", ExpiresAt: now.Add(-time.Minute)},
	}
	ban, drop = Decide(settings, nil, failures, existing, now)
	if len(ban) != 0 {
		t.Errorf("an address already banned was banned again: %+v", ban)
	}
	if len(drop) != 1 || drop[0] != "198.51.100.44" {
		t.Errorf("the expired ban was not released: %v", drop)
	}
}

func TestDisabledGuardDoesNotQuietlyLetAddressesBackIn(t *testing.T) {
	settings := Settings{Enabled: false, MaxRetry: 1, FindTime: time.Minute, BanTime: time.Hour}
	now := time.Now()
	failures := []Failure{{Engine: "postgresql", IP: "203.0.113.7", At: now}}
	ban, drop := Decide(settings, nil, failures, map[string]Ban{
		"198.51.100.44": {IP: "198.51.100.44", ExpiresAt: now.Add(-time.Minute)},
	}, now)
	if len(ban) != 0 || len(drop) != 0 {
		t.Errorf("a disabled guard should change nothing: ban=%v drop=%v", ban, drop)
	}
}

// The kernel expires a ban on its own, so an address stays out even if the panel is stopped
// when its ban runs out — the timeout is handed to nft as well as recorded in the panel.
func TestBansAreHandedToTheKernelWithTheirRemainingTime(t *testing.T) {
	now := time.Now()
	argv := strings.Join(BanArgv(Ban{IP: "203.0.113.7", ExpiresAt: now.Add(30 * time.Minute)})[0], " ")
	if !strings.HasPrefix(argv, "nft add element inet barepod banned { 203.0.113.7 timeout ") {
		t.Fatalf("unexpected ban command: %s", argv)
	}
	if !strings.Contains(argv, "s }") {
		t.Errorf("the timeout is missing its unit: %s", argv)
	}
	if got := strings.Join(UnbanArgv("203.0.113.7"), " "); got != "nft delete element inet barepod banned { 203.0.113.7 }" {
		t.Errorf("unexpected unban command: %s", got)
	}
	if got := strings.Join(ListArgv(), " "); got != "nft list set inet barepod banned" {
		t.Errorf("unexpected list command: %s", got)
	}
	// The set must carry `flags timeout`, or nft refuses an element that has one.
	found := false
	for _, argv := range EnsureArgv() {
		if strings.Contains(strings.Join(argv, " "), "flags timeout;") {
			found = true
		}
	}
	if !found {
		t.Error("the set is not created with timeout support")
	}
}

// `nft add rule` appends where `add table` and `add set` do not, so preparing the guard twice
// would leave two copies of the drop rules — measured on the host as one more copy per restart.
// The chain is flushed before its rules are written, and this pins that order.
func TestPreparingTheGuardDoesNotDuplicateItsRules(t *testing.T) {
	flushAt, firstRuleAt := -1, -1
	for index, argv := range EnsureArgv() {
		line := strings.Join(argv, " ")
		switch {
		case line == "nft flush chain inet barepod input":
			flushAt = index
		case strings.HasPrefix(line, "nft add rule inet barepod input") && firstRuleAt < 0:
			firstRuleAt = index
		}
	}
	if flushAt < 0 || firstRuleAt < 0 {
		t.Fatalf("the chain is not flushed before its rules are written: flush=%d rule=%d", flushAt, firstRuleAt)
	}
	if flushAt > firstRuleAt {
		t.Errorf("the flush comes after the first rule (%d > %d), so a restart still duplicates", flushAt, firstRuleAt)
	}
}

// Redis aggregates identical failures into one entry carrying how many times it happened. Counting
// that entry once let a real attempt through unpunished: measured on the host, six refused AUTHs
// from one address arrived as a single entry with count=6 and produced no ban at all.
func TestRedisAggregatedRefusalsCountAsMany(t *testing.T) {
	entry := func(count string) string {
		return strings.Join([]string{
			"count", count, "reason", "auth", "context", "toplevel", "object", "AUTH",
			"username", "default", "age-seconds", "1.5", "client-info",
			"id=9 addr=172.17.0.3:41000 laddr=172.17.0.1:6379 fd=10",
		}, "\n")
	}
	if got := Scan("redis", entry("6")); len(got) != 6 {
		t.Errorf("six aggregated refusals counted as %d", len(got))
	}
	if got := Scan("redis", entry("999999")); len(got) != maxRefusalsPerEntry {
		t.Errorf("a wild count produced %d refusals, want the cap", len(got))
	}
	if got := Scan("redis", entry("1")); len(got) != 1 {
		t.Errorf("a single refusal counted as %d", len(got))
	}
}

// An engine may carry its own numbers, which is the whole point of separating them: five refusals
// from Redis and five from PostgreSQL need not mean the same thing, and a cache can be given a
// shorter window and a longer ban without touching every other engine.
func TestAnEngineCanHaveItsOwnNumbers(t *testing.T) {
	now := time.Date(2026, 10, 12, 9, 0, 0, 0, time.UTC)
	fallback := Settings{Enabled: true, MaxRetry: 5, FindTime: 10 * time.Minute, BanTime: time.Hour}
	perEngine := map[string]Settings{
		"redis": {Enabled: true, MaxRetry: 2, FindTime: time.Minute, BanTime: 6 * time.Hour},
	}
	failures := []Failure{
		{Engine: "redis", IP: "203.0.113.7", At: now.Add(-10 * time.Second)},
		{Engine: "redis", IP: "203.0.113.7", At: now.Add(-5 * time.Second)},
		{Engine: "postgresql", IP: "198.51.100.9", At: now.Add(-time.Minute)},
	}

	ban, _ := Decide(fallback, perEngine, failures, nil, now)
	if len(ban) != 1 {
		t.Fatalf("want only the engine whose own threshold was reached, got %+v", ban)
	}
	if ban[0].IP != "203.0.113.7" || ban[0].Engine != "redis" {
		t.Errorf("the wrong engine's address was banned: %+v", ban[0])
	}
	if !ban[0].ExpiresAt.Equal(now.Add(6 * time.Hour)) {
		t.Errorf("the ban did not use the engine's own time: %+v", ban[0].ExpiresAt)
	}
	if ban[0].Count != 2 {
		t.Errorf("the count is not the engine's own: %+v", ban[0])
	}

	// The same failures under the default saw nothing worth banning.
	ban, _ = Decide(fallback, nil, failures, nil, now)
	if len(ban) != 0 {
		t.Errorf("the default threshold banned somebody under it: %+v", ban)
	}
}
