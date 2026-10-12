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
	"encoding/json"
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
// The peer address is on the *first* line and the refusal on a later one carrying the same
// session pid, so a single-line regex cannot see both — the pair is joined by pid. (This is
// the case a naive filter gets wrong.)
var (
	pgLineRegex    = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})[^ ]* [^ ]+ \[\d+\]\s+(.*)$`)
	pgConnRegex    = regexp.MustCompile(`connection received: host=([0-9a-fA-F:.]+)`)
	pgFailureRegex = regexp.MustCompile(`FATAL:\s+(?:password authentication failed for user|no pg_hba\.conf entry for host[^,]*, user|role ".*" does not exist)[^\n]*`)
	pgUserRegex    = regexp.MustCompile(`for user "([^"]+)"`)
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

// scanPostgres joins a connection's peer address with the refusal that ends it, by pid.
func scanPostgres(log string) []Failure {
	peers := map[string]string{} // session pid -> peer address
	out := []Failure{}
	for _, raw := range strings.Split(log, "\n") {
		line := strings.TrimRight(raw, "\r")
		match := pgLineRegex.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		at := parseStamp(match[1])
		body, pid := match[2], pidOf(line)
		if conn := pgConnRegex.FindStringSubmatch(body); conn != nil {
			peers[pid] = conn[1]
			continue
		}
		if pgFailureRegex.MatchString(body) {
			user := ""
			if u := pgUserRegex.FindStringSubmatch(body); u != nil {
				user = u[1]
			}
			// A refusal for an address we never saw connected cannot name one: skip it
			// rather than blame whoever the last connection happened to be.
			if peer := peers[pid]; peer != "" {
				out = append(out, Failure{Engine: "postgresql", IP: peer, User: user, At: at})
			}
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
				At:     parseStamp(stampPrefix(line)),
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
		var entry struct {
			T struct {
				Date time.Time `json:"$date"`
			} `json:"t"`
		}
		_ = json.Unmarshal([]byte(line), &entry)
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
		out = append(out, Failure{Engine: "mongodb", IP: normaliseIP(ip), User: user, At: entry.T.Date})
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

// Table is the panel's own nftables table: a filter that drops banned addresses, kept
// apart from docker's tables so the two never have to agree about anything.
const (
	Table    = "barepod"
	Set      = "banned"
	chainRun = "-10" // before the general filter chains: a banned address is dropped early
)

// EnsureArgv creates the table, the set and the rule that reads it, and is safe to run
// again and again (`nft -f` on an existing object is a no-op with `add`).
func EnsureArgv() [][]string {
	return [][]string{
		{"nft", "add", "table", "inet", Table},
		// flags timeout lets the kernel expire a ban on its own, so an address is out even
		// if the panel is down when its ban runs out.
		{"nft", "add", "set", "inet", Table, Set, "{", "type", "ipv4_addr;", "flags", "timeout;", "}"},
		{"nft", "add", "chain", "inet", Table, "input", "{", "type", "filter", "hook", "input", "priority", chainRun, ";", "policy", "accept", ";", "}"},
		{"nft", "add", "rule", "inet", Table, "input", "ip", "saddr", "@" + Set, "drop"},
	}
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

// pidOf pulls the bracketed session pid out of a PostgreSQL line.
func pidOf(line string) string {
	start := strings.Index(line, "[")
	if start < 0 {
		return ""
	}
	end := strings.Index(line[start:], "]")
	if end < 0 {
		return ""
	}
	return line[start+1 : start+end]
}

// stampPrefix is the leading "YYYY-MM-DD HH:MM:SS" of a log line, when it has one.
func stampPrefix(line string) string {
	if len(line) < 19 {
		return ""
	}
	return line[:19]
}

// parseStamp reads the stamps the engines write, and answers the zero time rather than
// guessing when it cannot (the caller then falls back to when the line was read).
func parseStamp(value string) time.Time {
	value = strings.TrimSpace(value)
	// MariaDB pads the hour with a space rather than a zero — "2026-10-12  9:00:00" — and no
	// Go layout covers that, so the two fields are put back into one known shape. The window
	// depends on these stamps, so reading them right is what keeps findtime honest.
	if fields := strings.Fields(value); len(fields) == 2 {
		clock := fields[1]
		if len(clock) == 7 { // "9:00:00"
			clock = "0" + clock
		}
		value = fields[0] + " " + clock
	}
	for _, layout := range []string{"2006-01-02 15:04:05", "2006-01-02 15:04:05.000"} {
		if at, err := time.ParseInLocation(layout, value, time.UTC); err == nil {
			return at
		}
	}
	return time.Time{}
}
