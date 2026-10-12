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

// EnsureArgvForTest exposes what the panel asks the kernel to set up, so a test can assert
// the table it owns is the one it names.
func EnsureArgvForTest() [][]string { return guard.EnsureArgv() }

// NewGuard builds the watchdog this server runs. Its logger is the panel's own: a security
// loop nothing can observe is one nobody can diagnose, and a ban that failed to install must
// not be silent.
func NewGuard(exec guard.Executor, st *store.Store, interval time.Duration, logf func(string, ...any)) *guard.Guard {
	return guard.New(exec, NewGuardStore(st), interval, logf)
}

// GuardExecutor turns a host runner into the watchdog's way of reaching the host.
func GuardExecutor(run func(ctx context.Context, dir, name string, args ...string) (string, error)) guard.Executor {
	return func(ctx context.Context, name string, args ...string) (string, error) {
		return run(ctx, "", name, args...)
	}
}
