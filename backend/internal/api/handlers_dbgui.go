package api

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// databaseGuiTools are the managers the panel can host behind its own session.
// The heavy ones have to be installed and are proxied here; the built-in browser
// needs nothing.
var databaseGuiTools = map[string]string{
	"browser":       "The panel's own table browser: it reads SQLite itself and lists the keys of a cache.",
	"adminer":       "One PHP file, covers PostgreSQL, MySQL/MariaDB and SQLite.",
	"phpmyadmin":    "The usual MySQL/MariaDB manager; needs PHP and its own docroot.",
	"pgadmin":       "PostgreSQL manager; a Python service of a few hundred megabytes.",
	"mongo-express": "MongoDB manager (Node).",
	"redis-command": "Redis key browser (Node).",
}

// handleDatabaseGui opens a manager for one database.
//
// The rule is the same for every tool, including the ones not installed yet: a
// browser only gets here through the panel — an unauthenticated request is sent to
// the sign-in screen instead of reaching a database tool, and the session,
// capability and audit trail all apply. Nothing is ever published on its own port.
func (s *Server) handleDatabaseGui(kind string) authedHandler {
	return func(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
		record, ok := s.findDatabase(w, r, user, kind)
		if !ok {
			return
		}
		tool := strings.TrimSpace(r.PathValue("tool"))
		if tool == "" {
			tools := []map[string]any{}
			for name, description := range databaseGuiTools {
				available := name == "browser" // the only one that needs no install
				tools = append(tools, map[string]any{
					"tool": name, "description": description, "available": available,
					"path": fmt.Sprintf("/api/v1/%s/%s/gui/%s", kind, record.ID, name),
				})
			}
			writeJSON(w, http.StatusOK, map[string]any{"database": record.ID, "tools": tools})
			return
		}

		if tool == "browser" {
			// The panel's own browser is the API itself: the UI draws the grid.
			writeJSON(w, http.StatusOK, map[string]any{
				"tool":     "browser",
				"database": record.ID,
				"tables":   fmt.Sprintf("/api/v1/%s/%s/tables", kind, record.ID),
				"query":    fmt.Sprintf("/api/v1/%s/%s/query", kind, record.ID),
				"note":     "Same origin as the panel: the sign-in session, capability check and audit all apply.",
			})
			return
		}

		description, known := databaseGuiTools[tool]
		if !known {
			writeError(w, http.StatusNotFound, "not_found", "Unknown tool")
			return
		}
		_ = s.store.Audit(user.ID, "database.gui_open", record.Name, clientIP(r), tool)
		writeError(w, http.StatusNotImplemented, "not_installed", fmt.Sprintf(
			"%s is not hosted by this daemon yet. When it is, it will run behind this same path — loopback only, credentials injected server-side, closed when idle — and never on a port of its own. (%s)",
			tool, description))
	}
}
