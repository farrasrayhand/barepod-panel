package api

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// tenantHome is one account, as the file browser's picker needs it.
type tenantHome struct {
	Username string `json:"username"`
	Group    string `json:"group"`
	Status   string `json:"status"`
	Home     string `json:"home"`
	Exists   bool   `json:"exists"`
}

// handleListTenants lists the panel accounts with their home directories, so an
// admin can open one in the host-wide file browser. An ordinary account only
// sees itself: it can browse its own home and nothing else.
func (s *Server) handleListTenants(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	users, err := s.store.ListUsers()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not list the accounts")
		return
	}

	items := []tenantHome{}
	for _, account := range users {
		if user.Role != "admin" && account.Username != user.Username {
			continue
		}
		home := filepath.Join(s.host.SitesRoot, account.Username)
		info, err := os.Stat(home)
		items = append(items, tenantHome{
			Username: account.Username,
			Group:    account.GroupName,
			Status:   account.Status,
			Home:     home,
			Exists:   err == nil && info.IsDir(),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "root": s.host.SitesRoot})
}
