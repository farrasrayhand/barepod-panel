package api

import (
	"net/http"

	"github.com/farrasrayhand/barepod-panel/backend/internal/rbac"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// effectivePermissions resolves a user's capabilities from its group.
// A root admin whose group cannot be found still gets everything, so a broken
// group row can never lock the operator out of the panel.
func (s *Server) effectivePermissions(user *store.User) map[string]bool {
	out := map[string]bool{}
	if user.GroupName != "" {
		if group, err := s.store.GroupByName(user.GroupName); err == nil {
			for _, capability := range rbac.All {
				out[capability] = group.Permissions.Allows(capability)
			}
			return out
		}
	}
	if user.Role == "admin" {
		return rbac.GrantAll()
	}
	return rbac.GrantNothing().Normalised()
}

// handleListGroups returns the permission groups (the panel's built-in data).
// The route is already gated on the "users" capability.
func (s *Server) handleListGroups(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	groups, err := s.store.ListGroups()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not list groups")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":        groups,
		"capabilities": rbac.All,
	})
}
