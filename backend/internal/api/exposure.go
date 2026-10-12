package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/guard"
	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// Exposure is the panel opening a database's port to the outside, which is a security decision
// and not a display setting. Three things are true of it by construction:
//
//   - It refuses to open anything while the brute-force lockout is not enforcing. A port opened
//     without a lockout is an invitation, and the panel is the thing that would have to explain
//     it.
//   - It changes the engine's own authorisation, not just a firewall: PostgreSQL gets a pg_hba
//     rule for that database and user, MariaDB an account that may connect from anywhere. A
//     firewall alone would be a wall around a door somebody left open.
//   - It says, per engine, exactly what it did and what it could not. A container engine's
//     listener is engine-wide, so the firewall is the whole control there and the record says
//     so rather than implying a per-database boundary that does not exist.

// handleSetExposure opens or closes one database's port.
func (s *Server) handleSetExposure(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	record, ok := s.findDatabase(w, r, user, store.KindDatabase)
	if !ok {
		return
	}
	if refuseDetected(w, record) {
		return
	}
	if record.FileBased || record.Port == 0 {
		writeError(w, http.StatusConflict, "not_applicable",
			"this database is a file, so it has no port to open or close")
		return
	}
	var body struct {
		Exposure string `json:"exposure"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "could not read the exposure")
		return
	}
	public := false
	switch strings.TrimSpace(body.Exposure) {
	case store.ExposurePublic:
		public = true
	case store.ExposurePrivate, "":
		public = false
	default:
		writeError(w, http.StatusBadRequest, "invalid_exposure", `exposure must be "public" or "private"`)
		return
	}

	if public {
		if s.guard == nil {
			writeError(w, http.StatusConflict, "guard_required",
				"a database port cannot be opened while the brute-force lockout is not running")
			return
		}
		if enforcing, reason := s.guard.Enforcing(r.Context()); !enforcing {
			writeError(w, http.StatusConflict, "guard_required",
				"a database port cannot be opened while the brute-force lockout is not enforcing: "+reason)
			return
		}
	}

	note, err := s.applyExposure(r.Context(), record, public)
	if err != nil {
		writeError(w, http.StatusBadGateway, "exposure_failed", err.Error())
		return
	}
	exposure := store.ExposurePrivate
	if public {
		exposure = store.ExposurePublic
	}
	if err := s.store.SetDatabaseExposure(record.ID, exposure, note); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	_ = s.store.Audit(user.ID, "database.exposure", record.Name, clientIP(r), exposure+": "+note)

	updated, err := s.store.DatabaseByID(record.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"database": updated, "exposure": exposure, "note": note})
}

// applyExposure does the work and describes it. It returns an error only when nothing could be
// done; a partial result is a note, because an operator has to know what is true rather than
// what was intended.
func (s *Server) applyExposure(ctx context.Context, record *store.Database, public bool) (string, error) {
	if record.FileBased || record.Port == 0 {
		return "", errors.New("this database is a file and has no port to open")
	}
	switch record.Engine {
	case "postgresql":
		return s.exposePostgres(ctx, record, public)
	case "mysql", "mariadb":
		return s.exposeMariaDB(ctx, record, public)
	case "mongodb", "redis":
		// These run with a listener that binds every interface (the container's own published
		// port) or an image whose config the panel does not own, so there is no per-database
		// authorisation to narrow. The panel's firewall is the control, and the record says so.
		if public {
			if note, err := s.openPort(ctx, record.Port); err != nil {
				return "", err
			} else {
				return note + "; this engine's listener is not per-database, so the firewall rule is what keeps it private", nil
			}
		}
		return s.closePort(ctx, record.Port)
	}
	return "", fmt.Errorf("no exposure handling for engine %q", record.Engine)
}

// exposePostgres narrows PostgreSQL itself: a pg_hba line for this database and user, plus a
// listener that is not loopback-only, and then the firewall.
func (s *Server) exposePostgres(ctx context.Context, record *store.Database, public bool) (string, error) {
	conf := newestPath("/etc/postgresql/*/main/postgresql.conf")
	hba := newestPath("/etc/postgresql/*/main/pg_hba.conf")
	if hba == "" {
		return "", errors.New("no pg_hba.conf was found, so PostgreSQL cannot be opened safely")
	}
	marker := "# barepod-public " + record.Name

	// The engine's authorisation first for a public database, so the firewall is never opened
	// onto a server that would refuse the connection anyway; the other way round for a private
	// one, so the door closes before anything else is discussed.
	body, err := os.ReadFile(hba)
	if err != nil {
		return "", err
	}
	kept := []string{}
	for _, line := range strings.Split(strings.TrimRight(string(body), "\n"), "\n") {
		if strings.HasPrefix(line, marker) {
			continue
		}
		kept = append(kept, line)
	}
	if public {
		address := record.Host
		if address == "" {
			address = "0.0.0.0/0"
		}
		if !strings.Contains(address, "/") {
			address += "/32"
		}
		kept = append(kept, marker,
			"host    "+record.Name+"    "+record.User+"    "+address+"    scram-sha-256")
	}
	if err := os.WriteFile(hba, []byte(strings.Join(kept, "\n")+"\n"), 0o640); err != nil {
		return "", err
	}

	note := "a pg_hba rule for " + record.Name + "/" + record.User
	if public {
		if conf != "" {
			if changed, err := ensureListenAll(conf); err != nil {
				note += "; the listener setting could not be read (" + err.Error() + ")"
			} else if changed {
				note += ", and PostgreSQL now listens on every interface"
			} else {
				note += ", and PostgreSQL already listened on every interface"
			}
		}
	}
	if out, err := s.host.Run(ctx, []string{"systemctl", "reload", "postgresql"}); err != nil {
		return note, fmt.Errorf("PostgreSQL did not reload: %s (%v)", strings.TrimSpace(out), err)
	}
	if public {
		opened, err := s.openPort(ctx, record.Port)
		if err != nil {
			return note, err
		}
		return note + "; " + opened, nil
	}
	closed, err := s.closePort(ctx, record.Port)
	if err != nil {
		return note, err
	}
	return note + " was removed; " + closed +
		" (PostgreSQL keeps listening on every interface, which is harmless while nothing may connect)", nil
}

// exposeMariaDB moves the account between the two places MariaDB allows it to live: localhost
// only, or anywhere.
func (s *Server) exposeMariaDB(ctx context.Context, record *store.Database, public bool) (string, error) {
	if record.User == "" || record.Name == "" {
		return "", errors.New("this record has no user or database name to grant")
	}
	if !public {
		if _, err := s.mysql(ctx, "DROP USER IF EXISTS '"+escapeSQL(record.User)+"'@'%'"); err != nil {
			return "", err
		}
		note, err := s.closePort(ctx, record.Port)
		if err != nil {
			return "", err
		}
		return "the account that could connect from anywhere was dropped; the record's own local account is untouched; " + note, nil
	}

	password := ""
	if record.PasswordCipher != "" {
		plain, err := secrets.Decrypt(s.key, record.PasswordCipher)
		if err != nil {
			return "", errors.New("the credential could not be decrypted, so no account could be created")
		}
		password = plain
	}
	if password == "" {
		return "", errors.New("this record has no stored password, so an account that may connect from anywhere cannot be created")
	}
	// The statement carries the password, so it travels in a root-only file rather than in the
	// argument list where any process list would show it.
	sql := "CREATE USER IF NOT EXISTS '" + escapeSQL(record.User) + "'@'%' IDENTIFIED BY '" + escapeSQL(password) + "';\n" +
		"GRANT ALL PRIVILEGES ON `" + strings.ReplaceAll(record.Name, "`", "``") + "`.* TO '" +
		escapeSQL(record.User) + "'@'%';\nFLUSH PRIVILEGES;\n"
	path := filepath.Join(os.TempDir(), "barepod-exposure-"+record.ID+".sql")
	if err := os.WriteFile(path, []byte(sql), 0o600); err != nil {
		return "", err
	}
	defer func() { _ = os.Remove(path) }()
	if _, err := s.mysql(ctx, "source "+path); err != nil {
		return "", err
	}
	note, err := s.openPort(ctx, record.Port)
	if err != nil {
		return "", err
	}
	return "an account that may connect from any address, granted on this database only, now exists; " + note +
		"; MariaDB's own bind-address decides whether it can be reached at all and the panel does not change it (a restart would be needed)", nil
}

// openPort and closePort are the kernel half: the engine's port leaves or enters the set the
// panel's own table drops from every interface but loopback.
func (s *Server) openPort(ctx context.Context, port int) (string, error) {
	argv := guard.OpenPortArgv(port)
	if out, err := s.host.Run(ctx, argv); err != nil && !strings.Contains(out, "No such file or directory") {
		return "", fmt.Errorf("the firewall rule could not be removed: %s (%v)", strings.TrimSpace(out), err)
	}
	return fmt.Sprintf("port %d is open to every address", port), nil
}

func (s *Server) closePort(ctx context.Context, port int) (string, error) {
	argv := guard.PrivatePortArgv(port)
	if out, err := s.host.Run(ctx, argv); err != nil {
		return "", fmt.Errorf("the firewall rule could not be installed: %s (%v)", strings.TrimSpace(out), err)
	}
	return fmt.Sprintf("port %d answers on loopback only", port), nil
}

// mysql runs one statement as the host's own MariaDB administrator.
func (s *Server) mysql(ctx context.Context, statement string) (string, error) {
	out, err := s.host.Run(ctx, []string{"mysql", "-N", "-B", "-e", statement})
	if err != nil {
		message := strings.TrimSpace(out)
		if message == "" {
			message = err.Error()
		}
		return out, errors.New("MariaDB refused the change: " + message)
	}
	return out, nil
}

// ensureListenAll makes PostgreSQL listen beyond loopback, and says whether it changed
// anything.
func ensureListenAll(conf string) (bool, error) {
	body, err := os.ReadFile(conf)
	if err != nil {
		return false, err
	}
	lines := strings.Split(string(body), "\n")
	changed := false
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "listen_addresses") {
			if strings.Contains(trimmed, "'*'") {
				return false, nil
			}
			lines[i] = "listen_addresses = '*'"
			changed = true
		}
	}
	if !changed {
		lines = append(lines, "# Added by BarePod: a database was opened to the outside.",
			"listen_addresses = '*'")
	}
	return true, os.WriteFile(conf, []byte(strings.Join(lines, "\n")), 0o644)
}

// handleDatabaseLog shows what the engine itself said, and what the panel did about this
// record: the two halves of "why did this happen".
func (s *Server) handleDatabaseLog(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	record, ok := s.findDatabase(w, r, user, store.KindDatabase)
	if !ok {
		return
	}
	lines, source, note, err := s.engineLog(r.Context(), record)
	if err != nil {
		writeError(w, http.StatusBadGateway, "log_unavailable", err.Error())
		return
	}
	if lines == nil {
		lines = []string{}
	}
	type auditItem struct {
		ID     int64  `json:"id"`
		At     string `json:"at"`
		TS     string `json:"ts"`
		Action string `json:"action"`
		Target string `json:"target,omitempty"`
		Detail string `json:"detail,omitempty"`
	}
	audit := []auditItem{}
	if entries, err := s.store.ListAudit("", 500); err == nil {
		for _, entry := range entries {
			if entry.Target == record.Name || entry.Target == record.Alias || entry.Target == record.ID {
				audit = append(audit, auditItem{
					ID:     entry.ID,
					At:     entry.At,
					TS:     entry.At,
					Action: entry.Action,
					Target: entry.Target,
					Detail: entry.Detail,
				})
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"engine": record.Engine,
		"source": source,
		"note":   note,
		"lines":  lines,
		"audit":  audit,
	})
}

// engineLog is the engine's own log as this host keeps it: a file for the host engines, the
// container's output for the containerised ones, and an honest note when there is neither.
func (s *Server) engineLog(ctx context.Context, record *store.Database) ([]string, string, string, error) {
	const tail = 300
	switch record.Engine {
	case "postgresql":
		path := newestPath("/var/log/postgresql/postgresql-*.log")
		if path == "" {
			return nil, "", "PostgreSQL writes no log file on this host, so the panel has nothing to read", nil
		}
		out, err := s.host.Run(ctx, []string{"tail", "-n", fmt.Sprint(tail), path})
		if err != nil {
			return nil, path, "", fmt.Errorf("the log could not be read: %v", err)
		}
		return splitLines(out), path, "", nil
	case "mysql", "mariadb":
		path := newestPath("/var/log/mysql/*.log")
		if path == "" {
			return nil, "", "MariaDB logs to the journal on this host; the panel reads files, so there is nothing to show yet", nil
		}
		out, err := s.host.Run(ctx, []string{"tail", "-n", fmt.Sprint(tail), path})
		if err != nil {
			return nil, path, "", fmt.Errorf("the log could not be read: %v", err)
		}
		return splitLines(out), path, "", nil
	case "mongodb", "redis":
		container := "barepod-" + record.Engine
		out, err := s.host.Run(ctx, []string{"docker", "logs", "--tail", fmt.Sprint(tail), container})
		if err != nil {
			message := strings.TrimSpace(out)
			return nil, "", "the container's output could not be read (" + message + "); it may not be running", nil
		}
		return splitLines(out), "docker logs " + container, "", nil
	case "sqlite":
		return []string{}, record.FilePath, "SQLite is a file-based embedded database — it operates directly in-process without a separate server daemon or service log file.", nil
	}
	return nil, "", "this engine keeps no log the panel can read", nil
}

// newestPath picks the newest file a glob matches, or "" when there is none.
func newestPath(pattern string) string {
	matches, err := filepath.Glob(pattern)
	if err != nil || len(matches) == 0 {
		return ""
	}
	newest := ""
	var newestAt int64
	for _, match := range matches {
		info, err := os.Stat(match)
		if err != nil {
			continue
		}
		if at := info.ModTime().UnixNano(); at > newestAt {
			newest, newestAt = match, at
		}
	}
	return newest
}

func escapeSQL(value string) string { return strings.ReplaceAll(value, "'", "''") }

func splitLines(out string) []string {
	trimmed := strings.TrimRight(out, "\n")
	if trimmed == "" {
		return []string{}
	}
	return strings.Split(trimmed, "\n")
}
