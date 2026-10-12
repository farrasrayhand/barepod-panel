package api

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/guard"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// guardStoreAdapter gives the watchdog the persistence it needs out of the panel's own
// database, translating between the two shapes so neither package has to know the other.
type guardStoreAdapter struct{ st *store.Store }

// NewGuardStore is the persistence side of the brute-force lockout.
func NewGuardStore(st *store.Store) guard.Store { return guardStoreAdapter{st: st} }

func (a guardStoreAdapter) Settings() (guard.Settings, error) {
	row, err := a.st.GuardSettings()
	if err != nil {
		return guard.Settings{}, err
	}
	return guard.Settings{Enabled: row.Enabled, MaxRetry: row.MaxRetry, FindTime: row.FindTime, BanTime: row.BanTime}, nil
}

func (a guardStoreAdapter) Bans() ([]guard.Ban, error) {
	rows, err := a.st.GuardBans()
	if err != nil {
		return nil, err
	}
	out := make([]guard.Ban, 0, len(rows))
	for _, row := range rows {
		out = append(out, guard.Ban{
			IP: row.IP, Engine: row.Engine, User: row.User, Reason: row.Reason,
			Count: row.Hits, At: row.BannedAt, ExpiresAt: row.ExpiresAt,
		})
	}
	return out, nil
}

func (a guardStoreAdapter) SaveBan(ban guard.Ban) error {
	return a.st.SaveGuardBan(store.GuardBan{
		IP: ban.IP, Engine: ban.Engine, User: ban.User, Reason: ban.Reason, Hits: ban.Count,
		BannedAt: ban.At, ExpiresAt: ban.ExpiresAt,
	})
}

func (a guardStoreAdapter) DropBan(ip string) error { return a.st.DropGuardBan(ip) }

// EngineSettings reads the per-engine overrides, so an engine can carry its own numbers.
func (a guardStoreAdapter) EngineSettings() (map[string]guard.Settings, error) {
	rows, err := a.st.EngineGuardSettings()
	if err != nil {
		return nil, err
	}
	out := make(map[string]guard.Settings, len(rows))
	for engine, row := range rows {
		out[engine] = guard.Settings{
			Enabled: row.Enabled, MaxRetry: row.MaxRetry, FindTime: row.FindTime, BanTime: row.BanTime,
		}
	}
	return out, nil
}

func (a guardStoreAdapter) DropExpired(now time.Time) (int, error) {
	released, err := a.st.DropExpiredGuardBans(now)
	return int(released), err
}

// Bounds on what an operator may set. A window of seconds or a ban of a year are both ways
// to make the lockout useless, so they are refused with the reason rather than accepted.
const (
	guardMinRetry = 1
	guardMaxRetry = 100
	guardMinFind  = 10 * time.Second
	guardMaxFind  = 24 * time.Hour
	guardMinBan   = time.Minute
	guardMaxBan   = 30 * 24 * time.Hour
)

// handleGuardStatus reports the lockout: its numbers, the addresses it is keeping out, and
// whether it can really enforce a ban on this host.
func (s *Server) handleGuardStatus(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	if s.guard == nil {
		writeError(w, http.StatusServiceUnavailable, "guard_unavailable",
			"the brute-force lockout is not running in this process")
		return
	}
	writeJSON(w, http.StatusOK, s.guard.Snapshot(r.Context()))
}

// handleGuardSettings changes the numbers the lockout decides with. They live in the panel
// so an operator never has to edit another daemon's configuration language over SSH.
func (s *Server) handleGuardSettings(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var body struct {
		Enabled  *bool   `json:"enabled"`
		MaxRetry *int    `json:"maxRetry"`
		FindTime *string `json:"findTime"`
		BanTime  *string `json:"banTime"`
		// Engine targets one engine. Empty means the default, which every engine without its own
		// numbers uses. Reset returns that engine to the default.
		Engine string `json:"engine"`
		Reset  bool   `json:"reset"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "could not read the lockout settings")
		return
	}
	current, err := s.store.GuardSettings()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	next := current
	if body.Enabled != nil {
		next.Enabled = *body.Enabled
	}
	if body.MaxRetry != nil {
		if *body.MaxRetry < guardMinRetry || *body.MaxRetry > guardMaxRetry {
			writeError(w, http.StatusBadRequest, "invalid_retries", "the number of failed logins must be between 1 and 100")
			return
		}
		next.MaxRetry = *body.MaxRetry
	}
	if body.FindTime != nil {
		parsed, err := time.ParseDuration(*body.FindTime)
		if err != nil || parsed < guardMinFind || parsed > guardMaxFind {
			writeError(w, http.StatusBadRequest, "invalid_find_time", "the window must be between 10s and 24h")
			return
		}
		next.FindTime = parsed
	}
	if body.BanTime != nil {
		parsed, err := time.ParseDuration(*body.BanTime)
		if err != nil || parsed < guardMinBan || parsed > guardMaxBan {
			writeError(w, http.StatusBadRequest, "invalid_ban_time", "the ban must last between 1m and 720h")
			return
		}
		next.BanTime = parsed
	}
	// One engine may carry its own numbers, and this is the only place they are set: the panel's own
	// Settings → Security, behind the administrative capability. A lockout a tenant could loosen is
	// not a lockout.
	if engine := strings.TrimSpace(body.Engine); engine != "" {
		var err error
		if body.Reset {
			err = s.store.DropEngineGuardSettings(engine)
		} else {
			existing, _ := s.store.EngineGuardSettings()
			value := next
			if had, found := existing[engine]; found && body.MaxRetry == nil && body.FindTime == nil && body.BanTime == nil {
				value = had
			}
			err = s.store.SaveEngineGuardSettings(engine, value)
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "store_error", err.Error())
			return
		}
		action := "guard.engine_settings"
		detail := fmt.Sprintf("engine=%s maxRetry=%d findTime=%s banTime=%s", engine, next.MaxRetry, next.FindTime, next.BanTime)
		if body.Reset {
			detail = "engine=" + engine + " reset to the default"
		}
		_ = s.store.Audit(user.ID, action, "bruteforce", clientIP(r), detail)
		if s.guard != nil {
			writeJSON(w, http.StatusOK, s.guard.Snapshot(r.Context()))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"settings": next, "engine": engine})
		return
	}

	if err := s.store.SaveGuardSettings(next); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	_ = s.store.Audit(user.ID, "guard.settings", "bruteforce", clientIP(r), fmt.Sprintf(
		"enabled=%t maxRetry=%d findTime=%s banTime=%s",
		next.Enabled, next.MaxRetry, next.FindTime, next.BanTime))

	if s.guard == nil {
		writeJSON(w, http.StatusOK, map[string]any{"settings": next})
		return
	}
	writeJSON(w, http.StatusOK, s.guard.Snapshot(r.Context()))
}

// handleGuardUnban releases one address, and says which one in the audit trail: letting
// somebody back in is a security decision and has to be attributable.
func (s *Server) handleGuardUnban(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	// Asked before the body is read: a panel with no watchdog cannot release anything whatever
	// the request says, and answering "invalid body" would blame the caller for the panel's
	// own state.
	if s.guard == nil {
		writeError(w, http.StatusServiceUnavailable, "guard_unavailable",
			"the brute-force lockout is not running in this process")
		return
	}
	var body struct {
		IP string `json:"ip"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "could not read the address")
		return
	}
	ip := strings.TrimSpace(body.IP)
	if net.ParseIP(ip) == nil || strings.Contains(ip, ":") {
		writeError(w, http.StatusBadRequest, "invalid_ip", "give one IPv4 address to release")
		return
	}
	if err := s.guard.Unban(r.Context(), ip); err != nil {
		writeError(w, http.StatusInternalServerError, "guard_error", err.Error())
		return
	}
	_ = s.store.Audit(user.ID, "guard.ip_unbanned", ip, clientIP(r), "released by hand")
	writeJSON(w, http.StatusOK, s.guard.Snapshot(r.Context()))
}

// LoginRefusals reads the panel's own refused logins from its audit trail. The address there
// carries the client's port, which is stripped: a ban is about an address, not a connection.
func (a guardStoreAdapter) LoginRefusals(afterID int64) ([]guard.LoginRefusal, error) {
	rows, err := a.st.RefusedLogins(afterID, 200)
	if err != nil {
		return nil, err
	}
	out := make([]guard.LoginRefusal, 0, len(rows))
	for _, row := range rows {
		at, _ := time.Parse(time.RFC3339, row.At)
		out = append(out, guard.LoginRefusal{
			ID: row.ID, At: at, IP: stripPort(row.IP), User: row.Target, Detail: row.Detail,
		})
	}
	return out, nil
}

// LatestLoginRefusalID is where the guard starts counting the panel's own refusals.
func (a guardStoreAdapter) LatestLoginRefusalID() (int64, error) { return a.st.LatestRefusedLoginID() }

// stripPort turns "127.0.0.1:34016" into "127.0.0.1": the audit trail records the connection, and a
// firewall bans an address.
func stripPort(address string) string {
	if host, _, err := net.SplitHostPort(address); err == nil {
		return host
	}
	return strings.TrimSpace(address)
}

// EnsureArgvForTest exposes what the panel asks the kernel to set up, so a test can assert
// the table it owns is the one it names.
func EnsureArgvForTest() [][]string { return guard.EnsureArgv() }

// NewGuard builds the watchdog this server runs. Its logger is the panel's own: a security
// loop nothing can observe is one nobody can diagnose, and a ban that failed to install must
// not be silent. redisURL is the panel's Redis identity, so the cache's refusals can be read from
// Redis's ACL log — the only place Redis records them.
func NewGuard(exec guard.Executor, st *store.Store, interval time.Duration, redisURL string, logf func(string, ...any)) *guard.Guard {
	watchdog := guard.New(exec, NewGuardStore(st), interval, logf)
	watchdog.UseRedisACL(redisURL)
	return watchdog
}

// GuardExecutor turns a host runner into the watchdog's way of reaching the host.
func GuardExecutor(run func(ctx context.Context, dir, name string, args ...string) (string, error)) guard.Executor {
	return func(ctx context.Context, name string, args ...string) (string, error) {
		return run(ctx, "", name, args...)
	}
}
