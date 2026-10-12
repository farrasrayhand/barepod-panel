package guard

import (
	"strings"
	"testing"
	"time"
)

// A ban earned on the panel or on SSH closes that door; a ban earned on a database engine closes the
// host, because an address attacking a database has no business reaching anything else either.
func TestABanClosesTheDoorItEarned(t *testing.T) {
	host := Ban{IP: "203.0.113.7", ExpiresAt: time.Now().Add(time.Hour)}
	if got := strings.Join(BanArgv(host)[0], " "); !strings.HasPrefix(got, "nft add element inet barepod banned {") {
		t.Errorf("a host-wide ban did not use the host set: %s", got)
	}
	scoped := Ban{IP: "203.0.113.7", Ports: []int{8443}, ExpiresAt: time.Now().Add(time.Hour)}
	if got := strings.Join(BanArgv(scoped)[0], " "); !strings.Contains(got, "banned_port") ||
		!strings.Contains(got, "203.0.113.7 . 8443") {
		t.Errorf("a scoped ban did not name its door: %s", got)
	}
	if got := strings.Join(UnbanBanArgv(scoped)[0], " "); !strings.Contains(got, "banned_port") {
		t.Errorf("releasing a scoped ban did not use the scoped set: %s", got)
	}
	if got := strings.Join(UnbanBanArgv(host)[0], " "); strings.Contains(got, "banned_port") {
		t.Errorf("releasing a host-wide ban went to the wrong set: %s", got)
	}
}

// SSH can answer on two ports while its port is being moved — the safe way to move it is to add the new
// one and keep the old until the new answers — and one ban has to close both: a scope that covered one
// of them would leave the other open to the same attacker for the length of that window.
func TestOneBanCanCloseSeveralDoors(t *testing.T) {
	both := Ban{IP: "203.0.113.7", Ports: []int{22, 2222}, ExpiresAt: time.Now().Add(time.Hour)}
	commands := BanArgv(both)
	// One command per door: nft silently adds nothing for the comma-separated form, which is how this
	// was found — in the kernel, not in a unit test.
	if len(commands) != 2 {
		t.Fatalf("want one command per door, got %d", len(commands))
	}
	joined := strings.Join(commands[0], " ") + " | " + strings.Join(commands[1], " ")
	if !strings.Contains(joined, "203.0.113.7 . 22") || !strings.Contains(joined, "203.0.113.7 . 2222") {
		t.Errorf("a two-door ban did not name both: %s", joined)
	}
	for _, argv := range commands {
		if !strings.Contains(strings.Join(argv, " "), "timeout") {
			t.Errorf("an element was written without its own timeout: %v", argv)
		}
	}
	if released := UnbanBanArgv(both); len(released) != 2 {
		t.Errorf("releasing a two-door ban should name both, got %d commands", len(released))
	}
}

// sshd writes one line per refused password, and the rest of its output is not an attempt against it.
func TestSSHRefusalsAreReadFromTheLineThatCounts(t *testing.T) {
	log := strings.Join([]string{
		"Invalid user nobody from 203.0.113.7 port 51234",
		"Failed password for invalid user nobody from 203.0.113.7 port 51234 ssh2",
		"Failed password for root from 198.51.100.9 port 51235 ssh2",
		"Connection closed by authenticating user root 198.51.100.9 port 51236 [preauth]",
		"Accepted password for root from 203.0.113.7 port 51237 ssh2",
	}, "\n")
	got := Scan("ssh", log)
	if len(got) != 2 {
		t.Fatalf("want the two refused passwords and nothing else, got %+v", got)
	}
	if got[0].IP != "203.0.113.7" || got[0].User != "nobody" || got[0].Engine != "ssh" {
		t.Errorf("the first refusal was not read as written: %+v", got[0])
	}
	if got[1].IP != "198.51.100.9" {
		t.Errorf("the second refusal lost its address: %+v", got[1])
	}
}

// The lockout must never ban the places an operator administers from, and an operator thinks in
// ranges — the office, a VPN pool — not in single addresses. An entry that only matched exactly would
// silently protect nobody inside the range it was meant to cover.
func TestATrustedEntryMayBeARange(t *testing.T) {
	was := Trusted
	Trusted = []string{"172.19.1.100", "10.8.0.0/24"}
	defer func() { Trusted = was }()
	if !IsTrusted("172.19.1.100") {
		t.Error("an exact entry stopped being trusted")
	}
	if !IsTrusted("10.8.0.42") {
		t.Error("an address inside a trusted range was not trusted")
	}
	if IsTrusted("10.9.0.42") {
		t.Error("an address outside every entry was trusted")
	}
}
