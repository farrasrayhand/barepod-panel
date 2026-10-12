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
	if got[0].At.IsZero() {
		t.Errorf("the timestamp was not read: %+v", got[0])
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

	ban, drop := Decide(settings, failures, nil, now)
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
	ban, drop = Decide(settings, failures, existing, now)
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
	ban, drop := Decide(settings, failures, map[string]Ban{
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
	argv := strings.Join(BanArgv(Ban{IP: "203.0.113.7", ExpiresAt: now.Add(30 * time.Minute)}), " ")
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
