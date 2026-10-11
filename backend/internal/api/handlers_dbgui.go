package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/dbengine"
	"github.com/farrasrayhand/barepod-panel/backend/internal/dbtools"
	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// writeManagerStarting answers a page load with "still preparing" instead of an error:
// the browser reloads itself until the manager answers, and the reason for the wait is
// on the page. Only the page load gets this — an asset request must never receive HTML.
func writeManagerStarting(w http.ResponseWriter, tool, mount string, cause error) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Retry-After", "2")
	// The look is the maintenance page's own (light card, amber status dot with the ping
	// animation, a bouncing icon, prefers-reduced-motion honoured) so a visitor sees one
	// panel, not two designs. Keep the two in step when either changes.
	_, _ = fmt.Fprintf(w, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="2">
<title>Preparing %[1]s · BarePod Panel</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f1f5f9;color:#0f172a;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px}
.card{width:100%%;max-width:34rem;background:#fff;border:1px solid #e2e8f0;border-radius:20px;box-shadow:0 10px 30px rgba(15,23,42,.06);padding:40px 36px;text-align:center}
@keyframes bounce{0%%,100%%{transform:translateY(-18%%);animation-timing-function:cubic-bezier(.8,0,1,1)}50%%{transform:none;animation-timing-function:cubic-bezier(0,0,.2,1)}}
@keyframes ping{75%%,100%%{transform:scale(2.4);opacity:0}}
.icon{position:relative;width:80px;height:80px;border-radius:24px;background:#eef2ff;border:1px solid #c7d2fe;color:#4f46e5;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;animation:bounce 1.6s infinite}
.icon svg{width:40px;height:40px}
.pill{position:absolute;top:-8px;right:-10px;background:#6366f1;color:#fff;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:999px}
h1{margin:0 0 8px;font-size:24px;font-weight:900;letter-spacing:-.02em}
p{margin:0;color:#475569}
.box{margin-top:24px;text-align:left;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden}
.row{display:flex;justify-content:space-between;gap:12px;padding:12px 16px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0}
.row:last-child{border-bottom:0}
.row b,.row code{color:#0f172a;font-weight:700}
.row code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:500;word-break:break-word}
.dot{position:relative;display:inline-block;width:8px;height:8px;border-radius:999px;background:#f59e0b;margin-right:6px}
.dot::after{content:"";position:absolute;inset:0;border-radius:999px;background:#f59e0b;animation:ping 1.4s cubic-bezier(0,0,.2,1) infinite}
.amber{color:#b45309;font-weight:700}
.reason{margin-top:16px;text-align:left;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:10px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#92400e;white-space:pre-wrap;word-break:break-word}
a{color:#2563eb;font-weight:600;text-decoration:none}
a:hover{text-decoration:underline}
.footer{margin-top:20px;font-size:11px;color:#94a3b8}
@media (prefers-reduced-motion: reduce){.icon,.dot::after{animation:none}}
</style></head>
<body><main class="card">
<div class="icon">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>
<span class="pill">Starting</span>
</div>
<h1>Preparing %[1]s…</h1>
<p>The manager is starting on demand — one container, loopback only, scoped to this database. This page reloads itself; it will appear as soon as it answers.</p>
<div class="box">
<div class="row"><span>Manager</span><b>%[1]s</b></div>
<div class="row"><span>Server</span><b>BarePod Panel</b></div>
<div class="row"><span>Status</span><span class="amber"><span class="dot"></span>Starting on demand</span></div>
<div class="row"><span>Panel</span><a href="%[2]s/">reload now</a></div>
</div>
<p class="reason">%[3]s</p>
<p class="footer">Nothing needs to be clicked — this page reloads itself until the manager answers.</p>
</main></body></html>
`, html.EscapeString(tool), html.EscapeString(mount), html.EscapeString(cause.Error()))
}

// guiMountRoot reports whether this request is the mount root — the page a browser is
// given. The wildcard segment captures the trailing slash, so the path is "" or "/"
// depending on how the request was written; both are the root.
func guiMountRoot(r *http.Request) bool {
	return strings.Trim(r.PathValue("path"), "/") == ""
}

// guiCookie is the anti-CSRF cookie issued for one proxied manager. The tool's
// own client cannot carry our X-CSRF-Token header, so the panel issues this
// path-scoped HttpOnly cookie when the page is opened and requires it for every
// request under the mount. It is SameSite=Strict, so a cross-site request (which
// still carries the session cookie on a top-level navigation) does not have it.
const guiCookie = "barepod_gui"

// guiTool describes a manager the panel can put behind its own session.
type guiTool struct {
	name        string
	description string
	// engines the tool can open; empty means any engine.
	engines []string
	// hosted is false for a manager that is decided but not built yet.
	hosted bool
}

// databaseGuiTools is the decided shape: the panel's own browser, pgweb for
// PostgreSQL, and DbGate as the plan. pgAdmin, phpMyAdmin and Adminer were
// weighed and dropped; redis-commander is not needed because the cache browser
// is ours.
var databaseGuiTools = []guiTool{
	{name: "browser", description: "The panel's own table browser: it reads SQLite itself, lists a cache's keys and runs SQL.", hosted: true},
	{name: "pgweb", description: "A small PostgreSQL browser (one Go binary): started on demand, this database's credential injected server-side, stopped when idle.", engines: []string{"postgresql"}, hosted: true},
	{name: "phpmyadmin", description: "The familiar MySQL/MariaDB manager, run by PHP's own small server: one process, no Apache or PHP-FPM, no login (the credential is injected server-side), stopped when idle.", engines: []string{"mysql", "mariadb"}, hosted: true},
	{name: "dbgate", description: "A click-and-browse manager for every engine here — PostgreSQL, MySQL/MariaDB, SQLite and MongoDB. Each database gets its own container on its own loopback port (never published), started on first access and removed when idle, so several databases — and several accounts — can have it open at once.", hosted: true},
}

// dbgatePortMin/Max is the loopback range DbGate instances are given: one port per
// database that has the manager open, never a published or public one.
const (
	dbgatePortMin = 8793
	dbgatePortMax = 8892
)

// dbgateContainerName is the per-database container name, which is also the
// supervisor's instance key.
//
// The record id cannot be used as-is: Docker allows only [a-zA-Z0-9][a-zA-Z0-9_.-] in a
// name, and a detected SQLite record's id is "det:sqlite:<base64>" — its colons made
// docker refuse the container outright ("Invalid container name …"), and the panel's
// waiting page reported that verbatim. A short digest of the id is stable, valid for
// every kind of id, and short enough for a name.
func dbgateContainerName(recordID string) string {
	sum := sha256.Sum256([]byte(recordID))
	return "barepod-dbgate-" + hex.EncodeToString(sum[:])[:12]
}

// guiToolInstallDir is the subdirectory under DbtoolsDir where a tool that needs
// installing was unpacked; a tool that is a single binary elsewhere (pgweb) has
// none, and an empty answer means "no install directory to check".
func guiToolInstallDir(tool string) string {
	if tool == "phpmyadmin" {
		return "phpmyadmin"
	}
	return ""
}

func guiToolByName(name string) (guiTool, bool) {
	for _, tool := range databaseGuiTools {
		if tool.name == name {
			return tool, true
		}
	}
	return guiTool{}, false
}

// guiKindPath is the URL collection segment for a kind: the ledger calls it
// "database"/"cache", while the routes call it "databases"/"caches". The mount
// handed to the proxy must be the real request path, so this mapping matters.
func guiKindPath(kind string) string {
	if kind == store.KindCache {
		return "caches"
	}
	return "databases"
}

func guiToolSupportsEngine(tool guiTool, engine string) bool {
	if len(tool.engines) == 0 {
		return true
	}
	for _, candidate := range tool.engines {
		if candidate == engine {
			return true
		}
	}
	return false
}

// guiToolAvailability answers whether a tool can open this record right now, and
// the path the UI should open when it can. A tool that needs an install is only
// offered when its binary is really on the host, so the panel never shows a
// button that cannot work.
func (s *Server) guiToolAvailability(kind string, record *store.Database, tool guiTool) (path string, available bool, reason string) {
	mount := fmt.Sprintf("/api/v1/%s/%s/gui/%s", guiKindPath(kind), record.ID, tool.name)
	if tool.name == "browser" {
		return mount, true, ""
	}
	if !guiToolSupportsEngine(tool, record.Engine) {
		return "", false, fmt.Sprintf("%s does not open %s databases", tool.name, record.Engine)
	}
	spec, ok := dbtools.Registry()[tool.name]
	if !ok || !tool.hosted {
		return "", false, fmt.Sprintf("%s is decided but not hosted by this daemon yet", tool.name)
	}
	// The database being the blocker is reported before the tool's install state:
	// a manager that cannot connect is the more useful thing to say.
	if reason, blocked := guiRecordBlocked(record); blocked {
		return "", false, reason
	}
	if tool.name == "dbgate" {
		if engine, found := s.engineFor(context.Background(), record.Engine); found {
			if reason, unreachable := dbgateReach(engine); unreachable {
				return "", false, reason
			}
		}
	}
	if reason, runnable := s.guiToolRunnable(spec); !runnable {
		return "", false, reason
	}
	if sub := guiToolInstallDir(tool.name); sub != "" {
		if _, err := os.Stat(filepath.Join(s.cfg.DbtoolsDir, sub, "index.php")); err != nil {
			return "", false, fmt.Sprintf("%s is not installed on this host yet (run scripts/install-engines.sh)", tool.name)
		}
	}
	return mount + "/", true, ""
}

// guiToolRunnable answers whether the host can actually run a tool, and why not: a
// container tool needs a real host with Docker, a binary tool needs its binary (and,
// either way, a daemon that is not in dry-run).
func (s *Server) guiToolRunnable(spec dbtools.Spec) (string, bool) {
	if spec.Container {
		if !s.host.Materialises() {
			return "the daemon is in dry-run mode, so no manager can be started", false
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if out, err := s.host.Runner.Run(ctx, "", "docker", "info"); err != nil {
			message := strings.TrimSpace(out)
			if message == "" {
				message = err.Error()
			}
			return "this host cannot run containers (" + truncate(message, 160) + ")", false
		}
		return "", true
	}
	// The missing binary is the more useful reason, so it is checked before the
	// daemon's mode.
	if _, ok := dbtools.Available(spec, s.lookPath); !ok {
		return fmt.Sprintf("%s is not installed on this host", spec.Binary), false
	}
	if !s.host.Materialises() {
		return "the daemon is in dry-run mode, so no manager can be started", false
	}
	return "", true
}

// truncate keeps a refusal short enough to read in a tooltip.
func truncate(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	return text[:limit] + "…"
}

// guiRecordBlocked answers why a server manager cannot be opened for a record: a
// database that was never actually created (a create whose client was missing),
// one that failed, or one in the recycle bin has no server to connect to — better
// to say so at once than to start a tool that dies and waits out its timeout.
func guiRecordBlocked(record *store.Database) (string, bool) {
	if record.DeletedAt != "" {
		return "it is in the recycle bin — restore it before opening a manager", true
	}
	if record.Status != "" && record.Status != "ready" {
		if note := strings.TrimSpace(record.Note); note != "" {
			return note, true
		}
		return "its status is " + record.Status, true
	}
	return "", false
}

// guiNotReadyNote is what the panel says about a record that cannot be opened. The
// note stored on a record can be stale — it was written when the engine's client was
// missing or the engine could not be provisioned yet, and neither may be true now —
// so an engine that is available and automated gets the sentence that says what to do
// instead, and the record is corrected so the list stops repeating an old failure.
func (s *Server) guiNotReadyNote(record *store.Database, engine dbengine.Engine, engineFound bool) (string, bool) {
	reason, blocked := guiRecordBlocked(record)
	if !blocked {
		return "", false
	}
	if record.DeletedAt == "" && engineFound && engine.Available && engine.Automated && !engine.FileBased {
		actionable := fmt.Sprintf("it was recorded but never created — %s is installed on this host now, so rotate the password to finish creating it", engine.Label)
		if strings.TrimSpace(record.Note) != actionable {
			_ = s.store.SetDatabaseStatus(record.ID, record.Status, actionable)
			record.Note = actionable
		}
		return actionable, true
	}
	return reason, true
}

// handleDatabaseGui is the gate: GET .../gui lists the managers, and
// GET .../gui/<tool> answers where to open one.
//
// The rule is the same for every tool, including the ones not installed yet: a
// browser only gets here through the panel. An unauthenticated request is sent to
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
			for _, candidate := range databaseGuiTools {
				path, available, reason := s.guiToolAvailability(kind, record, candidate)
				entry := map[string]any{
					"tool": candidate.name, "description": candidate.description,
					"available": available, "path": path,
				}
				if reason != "" {
					entry["note"] = reason
				}
				tools = append(tools, entry)
			}
			writeJSON(w, http.StatusOK, map[string]any{"database": record.ID, "tools": tools})
			return
		}

		known, exists := guiToolByName(tool)
		if !exists {
			writeError(w, http.StatusNotFound, "not_found", "Unknown tool")
			return
		}
		if tool == "browser" {
			// The panel's own browser is the API itself: the UI draws the grid.
			writeJSON(w, http.StatusOK, map[string]any{
				"tool":     "browser",
				"database": record.ID,
				"tables":   fmt.Sprintf("/api/v1/%s/%s/tables", guiKindPath(kind), record.ID),
				"query":    fmt.Sprintf("/api/v1/%s/%s/query", guiKindPath(kind), record.ID),
				"note":     "Same origin as the panel: the sign-in session, capability check and audit all apply.",
			})
			return
		}

		path, available, reason := s.guiToolAvailability(kind, record, known)
		if !available {
			_ = s.store.Audit(user.ID, "database.gui_open", record.Name, clientIP(r), tool+": "+reason)
			// The tool may exist and be installed; if the database itself is what is
			// blocking, say that instead of "not hosted", which would blame the tool.
			if _, isRecord := guiRecordBlocked(record); isRecord {
				engine, engineFound := s.engineFor(r.Context(), record.Engine)
				note, _ := s.guiNotReadyNote(record, engine, engineFound)
				writeError(w, http.StatusConflict, "not_ready", "This database is not ready to open — "+note)
				return
			}
			writeError(w, http.StatusNotImplemented, "not_installed", fmt.Sprintf(
				"%s is not hosted here yet (%s). When it is, it will run behind this same path — loopback only, credentials injected server-side, closed when idle — and never on a port of its own.",
				tool, reason))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"tool": tool, "database": record.ID, "available": true, "path": path,
			"note": "Open that path: it runs behind this same session, on loopback, with this database's credential injected server-side, and stops when idle.",
		})
	}
}

// handleDatabaseGuiProxy serves a hosted manager under the panel's own path.
//
// The full panel path is forwarded to the tool (it was told that exact prefix and
// strips it itself). The credential is decrypted on the daemon and injected into
// the command line; the browser never sees it and cannot point the tool at
// another database.
func (s *Server) handleDatabaseGuiProxy(kind string) authedHandler {
	return func(w http.ResponseWriter, r *http.Request, user *store.User, sess *store.Session) {
		record, ok := s.findDatabase(w, r, user, kind)
		if !ok {
			return
		}
		tool := strings.TrimSpace(r.PathValue("tool"))
		known, exists := guiToolByName(tool)
		if !exists {
			writeError(w, http.StatusNotFound, "not_found", "Unknown tool")
			return
		}
		if tool == "browser" {
			writeError(w, http.StatusNotFound, "not_found",
				"The panel's browser is served through its own API, not this path")
			return
		}
		spec, hosted := dbtools.Registry()[tool]
		if !hosted || !known.hosted {
			writeError(w, http.StatusNotImplemented, "not_installed", fmt.Sprintf(
				"%s is not hosted here yet. When it is, it will run behind this same path — loopback only, credentials injected server-side, closed when idle — and never on a port of its own.",
				tool))
			return
		}
		// The database being the blocker is reported before the tool's install state.
		if _, blocked := guiRecordBlocked(record); blocked {
			engine, engineFound := s.engineFor(r.Context(), record.Engine)
			note, _ := s.guiNotReadyNote(record, engine, engineFound)
			_ = s.store.Audit(user.ID, "database.gui_open", record.Name, clientIP(r), tool+": "+note)
			writeError(w, http.StatusConflict, "not_ready", "This database is not ready to open — "+note)
			return
		}
		if !guiToolSupportsEngine(known, record.Engine) {
			writeError(w, http.StatusConflict, "not_applicable",
				fmt.Sprintf("%s does not open %s databases", tool, record.Engine))
			return
		}
		// A file database has no server to connect to — except for DbGate, which
		// opens the SQLite file itself.
		if (record.Detected || record.FileBased) && tool != "dbgate" {
			writeError(w, http.StatusConflict, "not_applicable",
				"This is a file, not a server: use the Data Browser & SQL tab")
			return
		}
		if reason, runnable := s.guiToolRunnable(spec); !runnable {
			writeError(w, http.StatusNotImplemented, "not_installed",
				fmt.Sprintf("%s cannot be opened here: %s", tool, reason))
			return
		}
		if s.tools == nil {
			writeError(w, http.StatusServiceUnavailable, "service_error",
				"The database-tool supervisor is not configured on this daemon")
			return
		}
		// A file database carries no credential, so it is only decrypted when there
		// is one to decrypt.
		password := ""
		if !record.FileBased {
			plain, err := secrets.Decrypt(s.key, record.PasswordCipher)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "internal", "Could not decrypt the credential")
				return
			}
			password = plain
		}
		mount := fmt.Sprintf("/api/v1/%s/%s/gui/%s", guiKindPath(kind), record.ID, tool)

		// The page load (the mount root) issues the anti-CSRF cookie; every other
		// request under the mount must present it. The tool's own client cannot
		// carry our CSRF header, but a cross-site request does not carry this
		// cookie, so a statement cannot be run from another page.
		//
		// The mount root is what a browser is given — "/gui/<tool>/", with the trailing
		// slash — and the wildcard captures that slash, so an equality test against ""
		// never matched: the cookie was never issued, and every asset and API call the
		// page then made was refused with 403 (the page rendered from cache, and clicking
		// anything did nothing).
		if guiMountRoot(r) {
			http.SetCookie(w, &http.Cookie{
				Name: guiCookie, Value: sess.CSRFToken, Path: mount + "/",
				HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 3600,
			})
		} else if cookie, cerr := r.Cookie(guiCookie); cerr != nil || cookie.Value != sess.CSRFToken {
			writeError(w, http.StatusForbidden, "csrf",
				"Open this manager from the panel — the request did not carry this tool's own session")
			return
		}

		spec.Prefix = mount
		engine, engineFound := dbengine.Engine{}, false
		// The work a *start* needs — detecting the engine and its real address, writing the
		// tool's own config or env file, taking its loopback port — is done only when this
		// manager may actually have to start: on the page load, or when the instance is not
		// already serving this record. Doing it on every asset request is what made a page
		// crawl while another manager was in use (an engine detection and a file write per
		// asset, each of them seconds apart under load).
		starting := guiMountRoot(r) || s.guiServedFor(spec.Key()) != record.ID
		if starting {
			// A manager is told exactly where to connect, and a record can predate the
			// engine's current mode (a host install that is now a container publishes on
			// another port), so the address it hands out is corrected — and remembered —
			// before anything uses it.
			engine, engineFound = s.engineFor(r.Context(), record.Engine)
			if engineFound {
				if host, port, changed := engineAddress(engine, record); changed {
					if err := s.store.SetDatabaseAddress(record.ID, host, port); err == nil {
						record.Host, record.Port = host, port
					}
				}
				if tool == "dbgate" {
					if reason, unreachable := dbgateReach(engine); unreachable {
						writeError(w, http.StatusConflict, "not_reachable", reason)
						return
					}
				}
			}
			if spec.Name == "phpmyadmin" {
				dir, err := s.preparePhpMyAdmin(record, password, mount, r)
				if err != nil {
					writeError(w, http.StatusBadGateway, "service_error", err.Error())
					return
				}
				spec.DocRoot = dir
			}
		}
		if spec.Name == "dbgate" {
			// One container per database, named after the record and listening on its own
			// loopback port, so two databases — or two accounts — can have DbGate open at
			// once. A single shared container would have to be restarted for the second
			// one, which closes the page the first one already has open (DbGate's own
			// "Database connection closed").
			spec.ContainerName = dbgateContainerName(record.ID)
			spec.PortMin, spec.PortMax = dbgatePortMin, dbgatePortMax
			port, ok := s.tools.Port(spec)
			if !ok {
				writeError(w, http.StatusConflict, "busy", fmt.Sprintf(
					"all %d DbGate containers are in use — close one manager or wait for it to go idle (%d–%d)",
					dbgatePortMax-dbgatePortMin+1, dbgatePortMin, dbgatePortMax))
				return
			}
			spec.Port = port
			if starting {
				// The env file only matters to a container that is about to start; an asset
				// request for one already running must not rewrite it.
				plan, err := s.prepareDbGate(r.Context(), record, mount, engine)
				if err != nil {
					writeError(w, http.StatusBadGateway, "service_error", err.Error())
					return
				}
				spec.EnvFile = plan.envPath
				spec.Volumes = plan.volumes
				spec.User = plan.user
			}
		}
		if err := s.ensureGuiTool(r.Context(), spec, record, guiConnectionString(*record, password), engine, engineFound); err != nil {
			// Starting a manager is a `docker run` plus a server boot, and the first open is
			// exactly when that is felt. For the page load, a screen that says so and
			// reloads itself is the honest answer — the reload finds it ready — and the
			// reason the start gave is printed on it rather than swallowed by a JSON error.
			if guiMountRoot(r) {
				writeManagerStarting(w, tool, mount, err)
				return
			}
			writeError(w, http.StatusBadGateway, "service_error", err.Error())
			return
		}
		if guiMountRoot(r) {
			_ = s.store.Audit(user.ID, "database.gui_open", record.Name, clientIP(r), tool)
		}
		s.proxyGuiTool(w, r, spec, mount)
	}
}

// ensureGuiTool makes sure the tool serves this database, restarting it when a
// different database was the one it was serving: one loopback port means one
// database at a time, and the supervisor's single-flight keeps two requests from
// racing into two processes. Stop only ever stops a process the panel started.
//
// Once it is serving, every further request just slides the idle window in
// memory (Touch) instead of probing: a page makes many asset requests, and a
// probe (and, worse, an engine detection) per request would make it crawl.
func (s *Server) ensureGuiTool(ctx context.Context, spec dbtools.Spec, record *store.Database, dsn string, engine dbengine.Engine, engineFound bool) error {
	key := spec.Key()

	// A container tool is an instance of its own: its key *is* this record. Its start is
	// therefore nobody else's business, and it is done outside the global mutex — holding
	// that lock across a `docker run` (plus the wait for the server inside) is what made a
	// second manager's page slow while the first was starting. The supervisor is
	// single-flight per instance, so two requests for the same record cannot race here.
	if spec.Container {
		if s.guiServedFor(key) == record.ID {
			s.tools.Touch(key)
			return nil
		}
		if engineFound && engine.Mode == dbengine.ModeDocker {
			if _, err := s.ensureEngineRunning(ctx, engine); err != nil {
				return err
			}
		}
		if err := s.tools.Ensure(ctx, spec, dsn); err != nil {
			return err
		}
		s.guiMu.Lock()
		if s.guiServed == nil {
			s.guiServed = map[string]string{}
		}
		s.guiServed[key] = record.ID
		s.guiMu.Unlock()
		return nil
	}

	// A tool that is one process on one port (pgweb, phpMyAdmin) genuinely serves one
	// record at a time, so switching it has to be serialised: stop what is there, then
	// start it for this record. The lock is held for that, and only that.
	s.guiMu.Lock()
	defer s.guiMu.Unlock()
	if s.guiServed == nil {
		s.guiServed = map[string]string{}
	}
	if current, ok := s.guiServed[key]; ok {
		if current == record.ID {
			s.tools.Touch(key)
			return nil
		}
		if err := s.tools.Stop(ctx, spec); err != nil {
			return err
		}
		delete(s.guiServed, key)
	}
	// A containerised engine is brought up before the tool connects at start.
	if engineFound && engine.Mode == dbengine.ModeDocker {
		if _, err := s.ensureEngineRunning(ctx, engine); err != nil {
			return err
		}
	}
	if err := s.tools.Ensure(ctx, spec, dsn); err != nil {
		return err
	}
	s.guiServed[key] = record.ID
	return nil
}

// guiServedFor is which record an instance is known to be serving, read under the lock.
func (s *Server) guiServedFor(key string) string {
	s.guiMu.Lock()
	defer s.guiMu.Unlock()
	return s.guiServed[key]
}

// dropManagers stops the managers that could be holding a record's old credential and
// forgets them, so the next time one is opened it starts with the new one. A running
// manager was started with the password it was given and keeps it in its own env or
// command line: after a rotate it would answer "authentication failed" (DbGate's own
// "Database connection closed") until something restarted it, which is what the
// operator hit.
func (s *Server) dropManagers(ctx context.Context, record *store.Database) {
	if s.tools == nil {
		return
	}
	for _, spec := range dbtools.Registry() {
		if spec.Container {
			// A container is per record, so stopping it needs that record's name — the
			// port is not part of `docker rm -f`.
			spec.ContainerName = dbgateContainerName(record.ID)
		}
		_ = s.tools.Stop(ctx, spec)
		s.forgetGuiTool(spec.Key())
	}
}

// forgetGuiTool drops the record of a tool serving a database, so the next
// request starts it again: a tool that died is not left believed to be up.
func (s *Server) forgetGuiTool(name string) {
	s.guiMu.Lock()
	defer s.guiMu.Unlock()
	delete(s.guiServed, name)
}

// guiConnectionString is the DSN the panel injects into the tool, server-side.
// The credential is URL-encoded, so a password with special characters cannot
// change the meaning of the connection string.
func guiConnectionString(record store.Database, password string) string {
	scheme := record.Engine
	if scheme == "postgresql" {
		scheme = "postgres"
	}
	u := &url.URL{
		Scheme: scheme,
		User:   url.UserPassword(record.User, password),
		Host:   net.JoinHostPort(record.Host, strconv.Itoa(record.Port)),
		Path:   "/" + record.Name,
	}
	if record.Engine == "mongodb" {
		// The account lives in `admin`, so the DSN has to say so — otherwise the driver
		// takes the database in the path as the auth source and refuses the connection.
		u.RawQuery = "authSource=" + mongoUserDB
	}
	return u.String()
}

// preparePhpMyAdmin writes the config that opens exactly one database with no
// login at all: auth_type=config carries the credential, only_db scopes it, and
// PmaAbsoluteUri tells it the public mount — the proxy strips the mount, so
// phpMyAdmin sees its own root but must still generate the panel's URLs.
func (s *Server) preparePhpMyAdmin(record *store.Database, password, mount string, r *http.Request) (string, error) {
	dir := filepath.Join(s.cfg.DbtoolsDir, "phpmyadmin")
	if _, err := os.Stat(filepath.Join(dir, "index.php")); err != nil {
		return "", errors.New("phpMyAdmin is not installed on this host")
	}
	scheme := requestScheme(r)
	config := fmt.Sprintf(`<?php
$cfg['blowfish_secret'] = '%s';
$i = 1;
$cfg['Servers'][$i]['auth_type'] = 'config';
$cfg['Servers'][$i]['host'] = '%s';
$cfg['Servers'][$i]['port'] = %d;
$cfg['Servers'][$i]['user'] = '%s';
$cfg['Servers'][$i]['password'] = '%s';
$cfg['Servers'][$i]['only_db'] = '%s';
$cfg['Servers'][$i]['AllowNoPassword'] = false;
$cfg['PmaAbsoluteUri'] = '%s';
`, id.Token(16), phpQuote(record.Host), record.Port, phpQuote(record.User), phpQuote(password), phpQuote(record.Name),
		phpQuote(fmt.Sprintf("%s://%s%s/", scheme, r.Host, mount)))
	if err := os.WriteFile(filepath.Join(dir, "config.inc.php"), []byte(config), 0o600); err != nil {
		return "", err
	}
	return dir, nil
}

// phpQuote escapes a value for a single-quoted PHP string.
func phpQuote(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, `\`, `\\`), `'`, `\'`)
}

// proxyGuiTool forwards a request to the tool on loopback, keeping the full panel
// path: the tool was told that exact prefix and strips it itself.
func (s *Server) proxyGuiTool(w http.ResponseWriter, r *http.Request, spec dbtools.Spec, mount string) {
	target := &url.URL{Scheme: "http", Host: net.JoinHostPort("127.0.0.1", strconv.Itoa(spec.Port))}
	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			if spec.Strip {
				// The tool serves from its own root (phpMyAdmin has no prefix option):
				// drop the mount so it sees "/index.php". Its URLs are correct because
				// it was told the public base in its config.
				pr.Out.URL.Path = strings.TrimPrefix(pr.Out.URL.Path, mount)
				if !strings.HasPrefix(pr.Out.URL.Path, "/") {
					pr.Out.URL.Path = "/" + pr.Out.URL.Path
				}
				pr.Out.URL.RawPath = ""
			}
			pr.Out.Host = target.Host
		},
		ModifyResponse: func(resp *http.Response) error {
			rewriteGuiResponse(resp, mount)
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			// The tool is not answering: forget it, so the next request starts it
			// again instead of retrying a process that is gone.
			s.forgetGuiTool(spec.Key())
			// This is the refusal an operator reported on the first open — the dial to the
			// loopback port failed while the container was still coming up. The page load
			// gets the waiting screen, which reloads itself and finds it ready; an asset
			// request still gets the honest error, because it must not receive HTML.
			if guiMountRoot(r) {
				writeManagerStarting(w, spec.Name, mount, err)
				return
			}
			writeError(w, http.StatusBadGateway, "service_error",
				fmt.Sprintf("%s did not answer on loopback: %v", spec.Name, err))
		},
	}
	proxy.ServeHTTP(w, r)
}

// The tool is told its prefix, but some responses still carry a root-absolute
// Location or asset path ("pgweb considers itself at root"); those are pointed at
// the mount. A path already inside the mount is left alone, so nothing is
// prefixed twice, and another origin is never touched.
var (
	guiRootAbsoluteAttr = regexp.MustCompile(`(?i)(href|src|action)="(/[^"]*)"`)
	guiRootAbsoluteCSS  = regexp.MustCompile(`(?i)url\((/[^)"']*)\)`)
)

func rewriteGuiResponse(resp *http.Response, mount string) {
	prefix := strings.TrimSuffix(mount, "/") + "/"
	if location := resp.Header.Get("Location"); location != "" {
		resp.Header.Set("Location", rebaseGuiPath(location, prefix))
	}
	if !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/html") || resp.Header.Get("Content-Encoding") != "" {
		return
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	_ = resp.Body.Close()
	if err != nil {
		return
	}
	rewritten := rebaseGuiRootPaths(string(body), prefix)
	resp.Body = io.NopCloser(strings.NewReader(rewritten))
	resp.ContentLength = int64(len(rewritten))
	resp.Header.Set("Content-Length", strconv.Itoa(len(rewritten)))
}

// rebaseGuiPath points a root-absolute path (a redirect, say) at the mount.
func rebaseGuiPath(path, prefix string) string {
	insert := strings.TrimSuffix(prefix, "/")
	if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") {
		return path // relative, protocol-relative or another origin: leave it
	}
	if path == insert || strings.HasPrefix(path, prefix) {
		return path // already inside the mount
	}
	return insert + path
}

func rebaseGuiRootPaths(body, prefix string) string {
	insert := strings.TrimSuffix(prefix, "/")
	rebase := func(match string, submatches []string) string {
		path := submatches[2]
		if strings.HasPrefix(path, "//") || path == insert || strings.HasPrefix(path, prefix) {
			return match
		}
		return submatches[1] + `="` + insert + path + `"`
	}
	rebaseCSS := func(match string, submatches []string) string {
		path := submatches[1]
		if strings.HasPrefix(path, "//") || path == insert || strings.HasPrefix(path, prefix) {
			return match
		}
		return "url(" + insert + path + ")"
	}
	body = replaceGuiMatch(body, guiRootAbsoluteAttr, rebase)
	return replaceGuiMatch(body, guiRootAbsoluteCSS, rebaseCSS)
}

// replaceGuiMatch applies fn to every match of re, passing the whole match and
// its submatches so a caller can keep or rewrite the match as a whole.
func replaceGuiMatch(body string, re *regexp.Regexp, fn func(string, []string) string) string {
	matches := re.FindAllStringSubmatchIndex(body, -1)
	if len(matches) == 0 {
		return body
	}
	var out strings.Builder
	last := 0
	for _, index := range matches {
		out.WriteString(body[last:index[0]])
		whole := body[index[0]:index[1]]
		subs := []string{whole}
		for i := 1; i < len(index)/2; i++ {
			if index[2*i] < 0 {
				subs = append(subs, "")
				continue
			}
			subs = append(subs, body[index[2*i]:index[2*i+1]])
		}
		out.WriteString(fn(whole, subs))
		last = index[1]
	}
	out.WriteString(body[last:])
	return out.String()
}
