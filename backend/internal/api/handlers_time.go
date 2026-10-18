package api

import (
	"context"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// timezoneName is deliberately strict: the value is handed to timedatectl as an argument, and an
// operator picks it from the host's own list. It cannot contain spaces, quotes or a leading dash.
var timezoneName = regexp.MustCompile(`^[A-Za-z0-9_+\-]+(/[A-Za-z0-9_+\-]+){0,2}$`)

// hostTimezone reads the timezone the host itself reports, falling back to the file and then to the
// daemon's own location.
func (s *Server) hostTimezone(ctx context.Context) string {
	if out, err := s.host.Run(ctx, []string{"timedatectl", "show", "-p", "Timezone", "--value"}); err == nil {
		if tz := strings.TrimSpace(out); tz != "" {
			return tz
		}
	}
	if data, err := os.ReadFile("/etc/timezone"); err == nil {
		if tz := strings.TrimSpace(string(data)); tz != "" {
			return tz
		}
	}
	return time.Now().Location().String()
}

// hostTimezones lists the zones this host can be set to. A host without timedatectl returns none,
// and the UI then offers just the current zone.
func (s *Server) hostTimezones(ctx context.Context) []string {
	out, err := s.host.Run(ctx, []string{"timedatectl", "list-timezones"})
	if err != nil {
		return []string{}
	}
	zones := make([]string, 0, 64)
	for _, line := range strings.Split(out, "\n") {
		if zone := strings.TrimSpace(line); zone != "" {
			zones = append(zones, zone)
		}
	}
	return zones
}

// handleGetSystemTime reports the host timezone and the zones it can be changed to.
func (s *Server) handleGetSystemTime(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	writeJSON(w, http.StatusOK, map[string]any{
		"timezone": s.hostTimezone(ctx),
		"zones":    s.hostTimezones(ctx),
	})
}

// handleSetSystemTimezone applies a timezone to the host with timedatectl. In dry-run the runner
// records the command and the reported timezone is simply unchanged, which is the honest result.
func (s *Server) handleSetSystemTimezone(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var body struct {
		Timezone string `json:"timezone"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "could not read the timezone")
		return
	}
	tz := strings.TrimSpace(body.Timezone)
	if tz == "" || len(tz) > 64 || !timezoneName.MatchString(tz) {
		writeError(w, http.StatusBadRequest, "invalid_timezone", "that does not look like a timezone name, e.g. Asia/Makassar")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	out, err := s.host.Run(ctx, []string{"timedatectl", "set-timezone", tz})
	if err != nil {
		writeError(w, http.StatusBadGateway, "timezone_failed",
			"could not set the timezone: "+strings.TrimSpace(out)+" "+err.Error())
		return
	}

	applied := s.hostTimezone(ctx)
	_ = s.store.Audit(user.ID, "system.timezone", tz, clientIP(r), "set to "+applied)
	writeJSON(w, http.StatusOK, map[string]any{
		"timezone": applied,
		"mode":     s.host.Mode(),
	})
}
