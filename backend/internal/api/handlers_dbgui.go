package api

import (
	"context"
	"errors"
	"fmt"
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

	"github.com/farrasrayhand/barepod-panel/backend/internal/dbengine"
	"github.com/farrasrayhand/barepod-panel/backend/internal/dbtools"
	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

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
	{name: "dbgate", description: "One web container covering PostgreSQL, MySQL/MariaDB, SQLite, MongoDB and Redis — decided, not hosted yet.", hosted: false},
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
	if _, ok := dbtools.Available(spec, s.lookPath); !ok {
		return "", false, fmt.Sprintf("%s is not installed on this host", spec.Binary)
	}
	if sub := guiToolInstallDir(tool.name); sub != "" {
		if _, err := os.Stat(filepath.Join(s.cfg.DbtoolsDir, sub, "index.php")); err != nil {
			return "", false, fmt.Sprintf("%s is not installed on this host yet (run scripts/install-engines.sh)", tool.name)
		}
	}
	if !s.host.Materialises() {
		return "", false, "the daemon is in dry-run mode, so no manager can be started"
	}
	return mount + "/", true, ""
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
			if blocked, isRecord := guiRecordBlocked(record); isRecord {
				writeError(w, http.StatusConflict, "not_ready", "This database is not ready to open — "+blocked)
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
		if reason, blocked := guiRecordBlocked(record); blocked {
			writeError(w, http.StatusConflict, "not_ready", "This database is not ready to open — "+reason)
			return
		}
		if !guiToolSupportsEngine(known, record.Engine) {
			writeError(w, http.StatusConflict, "not_applicable",
				fmt.Sprintf("%s does not open %s databases", tool, record.Engine))
			return
		}
		if record.Detected || record.FileBased {
			writeError(w, http.StatusConflict, "not_applicable",
				"This is a file, not a server: use the Data Browser & SQL tab")
			return
		}
		if _, ok := dbtools.Available(spec, s.lookPath); !ok {
			writeError(w, http.StatusNotImplemented, "not_installed",
				fmt.Sprintf("%s is not installed on this host", spec.Binary))
			return
		}
		if !s.host.Materialises() {
			writeError(w, http.StatusNotImplemented, "not_installed",
				"The daemon is in dry-run mode: a database manager is only started on a real host")
			return
		}
		if s.tools == nil {
			writeError(w, http.StatusServiceUnavailable, "service_error",
				"The database-tool supervisor is not configured on this daemon")
			return
		}
		password, err := secrets.Decrypt(s.key, record.PasswordCipher)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not decrypt the credential")
			return
		}
		mount := fmt.Sprintf("/api/v1/%s/%s/gui/%s", guiKindPath(kind), record.ID, tool)

		// The page load (the mount root) issues the anti-CSRF cookie; every other
		// request under the mount must present it. The tool's own client cannot
		// carry our CSRF header, but a cross-site request does not carry this
		// cookie, so a statement cannot be run from another page.
		if r.PathValue("path") == "" {
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
		if spec.Name == "phpmyadmin" {
			dir, err := s.preparePhpMyAdmin(record, password, mount, r)
			if err != nil {
				writeError(w, http.StatusBadGateway, "service_error", err.Error())
				return
			}
			spec.DocRoot = dir
		}
		if err := s.ensureGuiTool(r.Context(), spec, record, guiConnectionString(*record, password)); err != nil {
			writeError(w, http.StatusBadGateway, "service_error", err.Error())
			return
		}
		if r.PathValue("path") == "" {
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
func (s *Server) ensureGuiTool(ctx context.Context, spec dbtools.Spec, record *store.Database, dsn string) error {
	s.guiMu.Lock()
	defer s.guiMu.Unlock()
	if s.guiServed == nil {
		s.guiServed = map[string]string{}
	}
	if current, ok := s.guiServed[spec.Name]; ok {
		if current == record.ID {
			s.tools.Touch(spec.Name)
			return nil
		}
		if err := s.tools.Stop(ctx, spec); err != nil {
			return err
		}
		delete(s.guiServed, spec.Name)
	}
	// A containerised engine is brought up before the tool connects at start.
	if engine, found := s.engineFor(ctx, record.Engine); found && engine.Mode == dbengine.ModeDocker {
		if _, err := s.ensureEngineRunning(ctx, engine); err != nil {
			return err
		}
	}
	if err := s.tools.Ensure(ctx, spec, dsn); err != nil {
		return err
	}
	s.guiServed[spec.Name] = record.ID
	return nil
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
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
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
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			// The tool is not answering: forget it, so the next request starts it
			// again instead of retrying a process that is gone.
			s.forgetGuiTool(spec.Name)
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
