// Package guard watches the database engines' own logs for refused logins and keeps the
// addresses that keep trying out of them — the lockout that has to exist *before* a
// database port is opened to the outside.
//
// It exists instead of fail2ban for three measured reasons: the packaged fail2ban on the
// target host (1.0.2 against Python 3.12) prints "Server ready" and exits 255 without a
// word in its own log; a container's log is not a file, so the panel's MongoDB — which
// logs to `docker logs` — is invisible to a file-reading tool; and the numbers an operator
// wants to change (retries, window, ban time) belong in the panel they already use, not in
// a second configuration language read by another daemon.
//
// Three rules are held throughout: a ban is *persisted* (a panel restart must not forget
// one), loopback is never banned (it is how the panel itself reaches the database), and a
// host that cannot enforce bans says so rather than pretending.
package guard

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Settings are the numbers an operator can change from the panel.
type Settings struct {
	Enabled  bool
	MaxRetry int
	FindTime time.Duration
	BanTime  time.Duration
}

// Defaults are deliberate: five refused logins inside ten minutes keep an address out for
// an hour. They are not fail2ban's defaults, which ban for ten minutes after five tries.
func Defaults() Settings {
	return Settings{Enabled: true, MaxRetry: 5, FindTime: 10 * time.Minute, BanTime: time.Hour}
}

// Failure is one refused login: who tried, from where, and which engine said so.
type Failure struct {
	Engine string
	IP     string
	User   string
	At     time.Time
}

// Ban is one address the panel keeps out until ExpiresAt.
type Ban struct {
	IP        string    `json:"ip"`
	Engine    string    `json:"engine"`
	User      string    `json:"user,omitempty"`
	Count     int       `json:"count"`
	Reason    string    `json:"reason"`
	At        time.Time `json:"at"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// postgres addresses: PostgreSQL 16 logs
//
//	2026-10-12 09:00:00.000 UTC [123] LOG:  connection received: host=203.0.113.7 port=51000
//	2026-10-12 09:00:00.010 UTC [123] FATAL:  password authentication failed for user "evil"
//
// The peer address is on the *first* line and the refusal on a later line carrying the same
// session pid, so a single-line regex cannot see both — the pair is joined by pid. (This is
// the case a naive filter gets wrong.)
//
// The line prefix is deliberately not matched: log_line_prefix is configurable, and the
// prefixes measured in practice differ (this host writes `%m [%p] %q%u@%d`). The pid and the
// message are all that is needed, and when the prefix carries the address itself (`%h`) the
// refusal names its own peer.
var (
	pgPIDRegex        = regexp.MustCompile(`\[(\d+)\]`)
	pgConnRegex       = regexp.MustCompile(`connection received: host=([0-9a-fA-F:.]+)`)
	pgFailureRegex    = regexp.MustCompile(`FATAL:\s+(?:password authentication failed for user|no pg_hba\.conf entry|role "[^"]*" does not exist)`)
	pgUserRegex       = regexp.MustCompile(`(?:for user|user) "([^"]+)"`)
	pgHostInLineRegex = regexp.MustCompile(`host=([0-9a-fA-F:.]+)`)
)

// mariadb addresses: MariaDB writes the peer into the refusal itself,
//
//	2026-10-12  9:00:00 5 [Warning] Access denied for user 'evil'@'203.0.113.7' (using password: YES)
var mariadbFailureRegex = regexp.MustCompile(`Access denied for user '([^']*)'@'([^']+)'`)

// mongodb logs JSON, with the peer nested in the attributes:
//
//	{"t":{"$date":"..."},"c":"ACCESS","msg":"Authentication failed","attr":{"principalName":"evil","remote":"203.0.113.7:51000"}}
var (
	mongoRemoteRegex = regexp.MustCompile(`"remote"\s*:\s*"([^":]+):\d+"`)
	mongoUserRegex   = regexp.MustCompile(`"principalName"\s*:\s*"([^"]+)"`)
)

// Scan records *what* happened and from where; it deliberately records no time. Engines
// stamp their own timezone into their own format — this host's PostgreSQL writes
// "Asia/Makassar", eight hours from the panel's clock — and a stamp taken at face value can
// land outside the window and let a real attack pass. The caller stamps each refusal with the
// moment it read the line, which is within one interval of the truth because the tailer reads
// only what was just appended.
//
// Scan reads one engine's log text (newest lines last, as every engine appends) and returns
// the refusals it can prove, with the address each one came from.
func Scan(engine, log string) []Failure {
	switch engine {
	case "postgresql":
		return scanPostgres(log)
	case "mysql", "mariadb":
		// 'user'@'address' — the first group is the account, the second the peer.
		return scanLinewise(log, mariadbFailureRegex, 1, 2)
	case "mongodb":
		return scanMongo(log)
	}
	return nil
}

// scanPostgres joins a connection's peer address with the refusal that ends it, by pid. When
// the prefix carries the address itself (`%h`) it is read from the refusal instead.
func scanPostgres(log string) []Failure {
	peers := map[string]string{} // session pid -> peer address
	out := []Failure{}
	for _, raw := range strings.Split(log, "\n") {
		line := strings.TrimRight(raw, "\r")
		pid := ""
		if match := pgPIDRegex.FindStringSubmatch(line); match != nil {
			pid = match[1]
		}
		if conn := pgConnRegex.FindStringSubmatch(line); conn != nil {
			if pid != "" {
				peers[pid] = conn[1]
			}
			continue
		}
		if !pgFailureRegex.MatchString(line) {
			continue
		}
		user := ""
		if u := pgUserRegex.FindStringSubmatch(line); u != nil {
			user = u[1]
		}
		peer := peers[pid]
		if peer == "" {
			if h := pgHostInLineRegex.FindStringSubmatch(line); h != nil {
				peer = h[1]
			}
		}
		// A refusal that names no address at all — the usual state of a server with
		// log_connections off — cannot be attributed, and is skipped rather than blamed on
		// whoever the last connection happened to be.
		if peer != "" {
			out = append(out, Failure{Engine: "postgresql", IP: normaliseIP(peer), User: user})
		}
	}
	return out
}

// scanLinewise is the shape two of the engines share: the address is in the refusing line.
func scanLinewise(log string, re *regexp.Regexp, userGroup, ipGroup int) []Failure {
	out := []Failure{}
	for _, raw := range strings.Split(log, "\n") {
		line := strings.TrimRight(raw, "\r")
		if match := re.FindStringSubmatch(line); match != nil {
			out = append(out, Failure{
				Engine: "mariadb",
				IP:     normaliseIP(match[ipGroup]),
				User:   match[userGroup],
			})
		}
	}
	return out
}

// scanMongo reads the JSON lines the container writes.
func scanMongo(log string) []Failure {
	out := []Failure{}
	for _, raw := range strings.Split(log, "\n") {
		line := strings.TrimRight(raw, "\r")
		if !strings.Contains(line, "Authentication failed") && !strings.Contains(line, "AuthenticationFailed") {
			continue
		}
		ip, user := "", ""
		if m := mongoRemoteRegex.FindStringSubmatch(line); m != nil {
			ip = m[1]
		}
		if m := mongoUserRegex.FindStringSubmatch(line); m != nil {
			user = m[1]
		}
		if ip == "" {
			continue
		}
		out = append(out, Failure{Engine: "mongodb", IP: normaliseIP(ip), User: user})
	}
	return out
}

// Decide is the whole policy, kept pure so it can be tested without a host: which
// addresses have earned a ban, which bans have expired, and nothing else. `counts` is the
// failures seen so far inside the window, per address.
func Decide(settings Settings, failures []Failure, existing map[string]Ban, now time.Time) (ban []Ban, drop []string) {
	if !settings.Enabled {
		// Disabled drops nothing either: a ban stays until it expires, so switching the
		// guard off does not quietly let an address back in.
		return nil, nil
	}
	recent := map[string][]Failure{}
	for _, failure := range failures {
		if failure.IP == "" || isLoopback(failure.IP) || IsTrusted(failure.IP) {
			continue
		}
		if now.Sub(failure.At) > settings.FindTime || failure.At.After(now) {
			continue
		}
		recent[failure.IP] = append(recent[failure.IP], failure)
	}
	for ip, seen := range recent {
		if _, already := existing[ip]; already {
			continue
		}
		if len(seen) < settings.MaxRetry {
			continue
		}
		last := seen[len(seen)-1]
		ban = append(ban, Ban{
			IP:        ip,
			Engine:    last.Engine,
			User:      last.User,
			Count:     len(seen),
			Reason:    fmt.Sprintf("%d refused logins within %s", len(seen), settings.FindTime),
			At:        now,
			ExpiresAt: now.Add(settings.BanTime),
		})
	}
	for ip, entry := range existing {
		if !entry.ExpiresAt.IsZero() && now.After(entry.ExpiresAt) {
			drop = append(drop, ip)
		}
	}
	return ban, drop
}

// --- host enforcement -------------------------------------------------------------------

// Table is the panel's own nftables table: a filter that drops banned addresses and keeps a
// private database's port off every interface but loopback, kept apart from docker's tables so
// the two never have to agree about anything.
const (
	Table = "barepod"
	Set   = "banned"
	// PortsSet holds the engine ports a database has not opened. Membership is what makes a
	// port private, so opening one is removing a single element — instantly reversible, and
	// visible in the same table as everything else the panel enforces.
	PortsSet = "private_ports"
	// ExemptSet holds the addresses that may still reach a private port: loopback, and the
	// docker bridge. The bridge is there because the panel's own managers are containers and
	// reach a containerised engine through the gateway (measured: 172.17.0.1 for a bridge of
	// 172.17.0.0/16) — dropping it would take away the one way a manager has to open the
	// engine the panel provisions. The LAN is not in this set: on the test host it is
	// 172.19.0.0/16, next to but distinct from the bridge.
	ExemptSet = "private_exempt"
	chainRun  = "-10" // before the general filter chains: a banned address is dropped early
)

// EnsureArgv creates the table, its sets and the rules that read them, and is safe to run again
// and again (`nft add` on an existing object is a no-op).
func EnsureArgv() [][]string {
	return [][]string{
		{"nft", "add", "table", "inet", Table},
		// flags timeout lets the kernel expire a ban on its own, so an address is out even
		// if the panel is down when its ban runs out.
		{"nft", "add", "set", "inet", Table, Set, "{", "type", "ipv4_addr;", "flags", "timeout;", "}"},
		{"nft", "add", "set", "inet", Table, PortsSet, "{", "type", "inet_service;", "}"},
		// flags interval is not decoration: without it nft refuses a CIDR, so the exemption for
		// loopback (127.0.0.0/8) and for the docker bridge silently failed to install — and the
		// drop rule below then took away the panel's own access to every engine it manages.
		// Measured: 127.0.0.1:27018 was blocked until the set carried this flag.
		{"nft", "add", "set", "inet", Table, ExemptSet, "{", "type", "ipv4_addr;", "flags", "interval;", "}"},
		{"nft", "add", "chain", "inet", Table, "input", "{", "type", "filter", "hook", "input", "priority", chainRun, ";", "policy", "accept", ";", "}"},
		// `add rule` appends, unlike `add table`/`add set`, so this guard is prepared by
		// flushing its own chain first. Measured: without it, every panel restart left another
		// copy of the drop rules behind (seven restarts, seven identical rules).
		{"nft", "flush", "chain", "inet", Table, "input"},
		{"nft", "add", "rule", "inet", Table, "input", "ip", "saddr", "@" + Set, "drop"},
		// Then the exempt addresses are let through (return hands the decision back to the
		// policy, which accepts), and only what is left is dropped from a private port.
		{"nft", "add", "rule", "inet", Table, "input", "ip", "saddr", "@" + ExemptSet, "return"},
		{"nft", "add", "rule", "inet", Table, "input", "tcp", "dport", "@" + PortsSet, "drop"},
	}
}

// ExemptArgv lets an address or network reach a private port. Loopback is put here at start, and
// so is the docker bridge when the host has one.
func ExemptArgv(cidr string) []string {
	return []string{"nft", "add", "element", "inet", Table, ExemptSet, "{", cidr, "}"}
}

// PrivatePortArgv keeps an engine's port reachable from the host only. A database that has not
// been opened is in this set, so "private" is the default state of the kernel's side too.
func PrivatePortArgv(port int) []string {
	return []string{"nft", "add", "element", "inet", Table, PortsSet, "{", strconv.Itoa(port), "}"}
}

// OpenPortArgv lets an engine's port be reached from anywhere — the kernel half of making one
// database public, applied only after the operator has said so and the watchdog is enforcing.
func OpenPortArgv(port int) []string {
	return []string{"nft", "delete", "element", "inet", Table, PortsSet, "{", strconv.Itoa(port), "}"}
}

// BanArgv keeps an address out for the rest of its ban time. The timeout is handed to the
// kernel as well as recorded in the panel, so the ban ends on time even with the daemon
// stopped.
func BanArgv(ban Ban) []string {
	seconds := int(time.Until(ban.ExpiresAt).Seconds())
	if seconds < 1 {
		seconds = 1
	}
	return []string{"nft", "add", "element", "inet", Table, Set, "{", ban.IP, "timeout", strconv.Itoa(seconds) + "s", "}"}
}

// UnbanArgv lets an address back in.
func UnbanArgv(ip string) []string {
	return []string{"nft", "delete", "element", "inet", Table, Set, "{", ip, "}"}
}

// ListArgv reads the set back, so the panel can report what the kernel is really dropping
// instead of what it believes it asked for.
func ListArgv() []string {
	return []string{"nft", "list", "set", "inet", Table, Set}
}

// trusted are addresses the panel must never ban: its own loopback, and anything the
// operator names (`Trusted` is set from the panel's configuration).
var Trusted []string

// IsTrusted reports whether an address is on the never-ban list.
func IsTrusted(ip string) bool {
	for _, entry := range Trusted {
		if entry == ip {
			return true
		}
	}
	return false
}

func isLoopback(ip string) bool {
	return ip == "127.0.0.1" || ip == "::1" || strings.HasPrefix(ip, "127.")
}

// normaliseIP strips a zone or a surrounding bracket so the same address is always the same
// key.
func normaliseIP(ip string) string {
	ip = strings.TrimSpace(ip)
	ip = strings.TrimPrefix(ip, "[")
	if idx := strings.LastIndex(ip, "]"); idx >= 0 {
		ip = ip[:idx]
	}
	if idx := strings.Index(ip, "%"); idx >= 0 {
		ip = ip[:idx]
	}
	return ip
}
