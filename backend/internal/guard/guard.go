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

// Ban is one address the panel keeps out until ExpiresAt. Port 0 closes the whole host; a port closes
// that door only, which is what the panel and SSH earn so an operator never loses their way back in.
type Ban struct {
	IP        string    `json:"ip"`
	Port      int       `json:"port,omitempty"`
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

// redis writes no log of failed authentications at all (measured: zero lines, loglevel notice), so
// its refusals come from ACL LOG — Redis's own record of recent ACL failures, in memory, which
// redis-cli prints field by field:
//
//	count
//	1
//	reason
//	auth
//	object
//	AUTH
//	username
//	nobody-here
//	age-seconds
//	0.008
//	client-info
//	id=241 addr=127.0.0.1:51606 laddr=127.0.0.1:6379 …
//
// Only `reason: auth` is a refusal to keep someone out. A `key` or `command` entry is a *tenant*
// reaching past its own prefix — banning that address would punish the application the panel
// itself scoped, so those entries are read and deliberately ignored.
var redisAddrRegex = regexp.MustCompile(`addr=([0-9a-fA-F.:]+):\d+`)

// sshd writes one line per refused password, and the address is on it:
//
//	Failed password for invalid user nobody from 203.0.113.7 port 51234 ssh2
//	Failed password for root from 203.0.113.7 port 51234 ssh2
//
// Only that line is counted. An "Invalid user" line arrives before it — counting both would make one
// attempt look like two — and "Connection closed by authenticating user" is a client that gave up
// before trying a password, which is not an attempt against it.
var sshFailureRegex = regexp.MustCompile(`Failed password for (?:invalid user )?([^ ]+) from ([0-9a-fA-F.:]+) port \d+`)

// maxRefusalsPerEntry caps how many refusals one aggregated ACL log entry is allowed to stand for.
// The decision only needs to reach the retry threshold, and the count is Redis's number, so there is
// no reason to turn a large one into a large slice.
const maxRefusalsPerEntry = 100

// scanSSH reads the refusals sshd records.
func scanSSH(log string) []Failure {
	out := []Failure{}
	for _, raw := range strings.Split(log, "\n") {
		line := strings.TrimRight(raw, "\r")
		match := sshFailureRegex.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		out = append(out, Failure{Engine: "ssh", IP: normaliseIP(match[2]), User: match[1]})
	}
	return out
}

// scanRedisACLLog reads the flattened ACL LOG entries and returns the authentication refusals.
func scanRedisACLLog(text string) []Failure {
	out := []Failure{}
	lines := strings.Split(text, "\n")
	var entry map[string]string
	flush := func() {
		if len(entry) == 0 {
			return
		}
		if entry["reason"] == "auth" {
			if addr := redisAddrRegex.FindStringSubmatch(entry["client-info"]); addr != nil {
				// Redis aggregates identical failures into one entry carrying how many times it
				// happened, so counting the entry as one would let a brute-forcer try a hundred
				// times and be counted once — measured: six refusals from one address produced a
				// single entry with count=6 and no ban. The repetition is capped because the count
				// is Redis's number, not something to allocate memory for.
				count, err := strconv.Atoi(entry["count"])
				if err != nil || count < 1 {
					count = 1
				}
				if count > maxRefusalsPerEntry {
					count = maxRefusalsPerEntry
				}
				for i := 0; i < count; i++ {
					out = append(out, Failure{
						Engine: "redis",
						IP:     normaliseIP(addr[1]),
						User:   entry["username"],
					})
				}
			}
		}
		entry = nil
	}
	for i := 0; i+1 < len(lines); i += 2 {
		field := strings.TrimSpace(lines[i])
		value := strings.TrimSpace(lines[i+1])
		switch field {
		case "count", "reason":
			// A new entry starts at its count field.
			if field == "count" {
				flush()
				entry = map[string]string{}
			}
			if entry == nil {
				entry = map[string]string{}
			}
			entry[field] = value
		case "username", "age-seconds", "client-info":
			if entry == nil {
				entry = map[string]string{}
			}
			entry[field] = value
		}
	}
	flush()
	return out
}

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
	case "redis":
		// Not a log: the caller read Redis's own ACL LOG, which is where its refusals live.
		return scanRedisACLLog(log)
	case "ssh":
		return scanSSH(log)
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
func Decide(settings Settings, perEngine map[string]Settings, failures []Failure, existing map[string]Ban, now time.Time) (ban []Ban, drop []string) {
	if !settings.Enabled {
		// Disabled drops nothing either: a ban stays until it expires, so switching the
		// guard off does not quietly let an address back in.
		return nil, nil
	}
	// An engine either has its own numbers or uses the default — one place to look, and an override
	// that is easy to remove.
	effective := func(engine string) Settings {
		if custom, found := perEngine[engine]; found {
			return custom
		}
		return settings
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
		// Counted per engine: five refusals from PostgreSQL and one from Redis is not six against
		// either of them, and each engine's own threshold decides.
		byEngine := map[string][]Failure{}
		for _, failure := range seen {
			byEngine[failure.Engine] = append(byEngine[failure.Engine], failure)
		}
		for engine, group := range byEngine {
			engineSettings := effective(engine)
			window := group[:0]
			for _, failure := range group {
				if now.Sub(failure.At) <= engineSettings.FindTime {
					window = append(window, failure)
				}
			}
			if len(window) < engineSettings.MaxRetry {
				continue
			}
			last := window[len(window)-1]
			ban = append(ban, Ban{
				IP:        ip,
				Engine:    engine,
				User:      last.User,
				Count:     len(window),
				Reason:    fmt.Sprintf("%d refused logins within %s", len(window), engineSettings.FindTime),
				At:        now,
				ExpiresAt: now.Add(engineSettings.BanTime),
			})
			break // one ban per address per pass, named after the engine that earned it
		}
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
	// ScopedSet holds (address, port) pairs — the doors closed for one address only. A concatenated
	// set is what nftables offers for it, and like the other sets it expires its own elements.
	ScopedSet = "banned_port"
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
		{"nft", "add", "set", "inet", Table, ScopedSet, "{", "type", "ipv4_addr", ".", "inet_service;", "flags", "timeout;", "}"},
		{"nft", "add", "chain", "inet", Table, "input", "{", "type", "filter", "hook", "input", "priority", chainRun, ";", "policy", "accept", ";", "}"},
		// `add rule` appends, unlike `add table`/`add set`, so this guard is prepared by
		// flushing its own chain first. Measured: without it, every panel restart left another
		// copy of the drop rules behind (seven restarts, seven identical rules).
		{"nft", "flush", "chain", "inet", Table, "input"},
		{"nft", "add", "rule", "inet", Table, "input", "ip", "saddr", "@" + Set, "drop"},
		{"nft", "add", "rule", "inet", Table, "input", "ip", "saddr", ".", "tcp", "dport", "@" + ScopedSet, "drop"},
		// The host talking to itself is not "outside": a connection to the host's own gateway
		// address comes from the loopback interface (measured: `ip route get 172.17.0.1` answers
		// `dev lo src 172.17.0.1`), and the panel itself must be able to reach an engine where
		// DbGate can reach it, or its own probe would report the door closed. Keyed on the
		// interface rather than the address, so the LAN is never exempt by accident.
		{"nft", "add", "rule", "inet", Table, "input", "iif", "lo", "return"},
		{"nft", "add", "rule", "inet", Table, "input", "ip", "saddr", "@" + ExemptSet, "return"},
		// Then the exempt addresses are let through (return hands the decision back to the
		// policy, which accepts), and only what is left is dropped from a private port.
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

// BanArgv keeps an address out for the rest of its ban time. The timeout is handed to the kernel as
// well as recorded in the panel, so the ban ends on time even with the daemon stopped. A ban with a
// port closes that door only.
func BanArgv(ban Ban) []string {
	seconds := int(time.Until(ban.ExpiresAt).Seconds())
	if seconds < 1 {
		seconds = 1
	}
	if ban.Port > 0 {
		return []string{"nft", "add", "element", "inet", Table, ScopedSet, "{", ban.IP, ".", strconv.Itoa(ban.Port),
			"timeout", strconv.Itoa(seconds) + "s", "}"}
	}
	return []string{"nft", "add", "element", "inet", Table, Set, "{", ban.IP, "timeout", strconv.Itoa(seconds) + "s", "}"}
}

// UnbanArgv lets an address back in, through the door it was kept out of.
func UnbanBanArgv(ban Ban) []string {
	if ban.Port > 0 {
		return []string{"nft", "delete", "element", "inet", Table, ScopedSet, "{", ban.IP, ".", strconv.Itoa(ban.Port), "}"}
	}
	return []string{"nft", "delete", "element", "inet", Table, Set, "{", ban.IP, "}"}
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
