package api

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// dbgatePlan is what one database needs for the DbGate container: the env file
// that preconfigures its single connection, the mounts (a SQLite file's directory
// has to reach the container) and the user to run as (so nothing the container
// writes into a site ends up root-owned).
type dbgatePlan struct {
	envPath string
	volumes []string
	user    string
}

// dbgateEngineRef maps our engine name to the DbGate plugin that opens it.
func dbgateEngineRef(engine string) (string, error) {
	switch engine {
	case "sqlite":
		return "sqlite@dbgate-plugin-sqlite", nil
	case "mongodb":
		return "mongo@dbgate-plugin-mongo", nil
	case "redis":
		return "redis@dbgate-plugin-redis", nil
	}
	return "", fmt.Errorf("DbGate does not open %s databases here", engine)
}

// prepareDbGate writes the env file that scopes one DbGate container to this
// database: a single preconfigured connection (so there is nothing to type), no
// auth of its own — the panel session is the door — and WEB_ROOT so the container
// serves under the panel's own mount.
func (s *Server) prepareDbGate(ctx context.Context, record *store.Database, mount string) (dbgatePlan, error) {
	engineRef, err := dbgateEngineRef(record.Engine)
	if err != nil {
		return dbgatePlan{}, err
	}
	plan := dbgatePlan{}
	lines := []string{
		"PORT=3000",
		"WEB_ROOT=" + mount,
		"SKIP_ALL_AUTH=1",
		"CONNECTIONS=bpod",
		"ENGINE_bpod=" + engineRef,
		"SINGLE_CONNECTION=bpod",
		"SINGLE_DATABASE=" + record.Name,
	}
	switch {
	case record.FileBased:
		// SQLite is a file: its directory has to reach the container, and the
		// container runs as the tenant so nothing it writes is root-owned.
		plan.volumes = []string{filepath.Dir(record.FilePath) + ":/dbgate-sqlite"}
		lines = append(lines, "FILE_bpod=/dbgate-sqlite/"+filepath.Base(record.FilePath))
		if ids := s.tenantIDs(ctx, record.TenantUser); ids != "" {
			plan.user = ids
		}
	default:
		password, err := secrets.Decrypt(s.key, record.PasswordCipher)
		if err != nil {
			return dbgatePlan{}, errors.New("the credential could not be decrypted")
		}
		host := record.Host
		if host == "" {
			host = "127.0.0.1"
		}
		lines = append(lines,
			"SERVER_bpod="+host,
			"PORT_bpod="+strconv.Itoa(record.Port),
			"USER_bpod="+record.User,
			"PASSWORD_bpod="+password,
			"DATABASE_bpod="+record.Name,
		)
	}
	if err := os.MkdirAll(s.cfg.DbtoolsDir, 0o700); err != nil {
		return dbgatePlan{}, err
	}
	plan.envPath = filepath.Join(s.cfg.DbtoolsDir, "dbgate-"+record.ID+".env")
	if err := os.WriteFile(plan.envPath, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		return dbgatePlan{}, err
	}
	return plan, nil
}

// tenantIDs is "<uid>:<gid>" for a tenant account, or "" when it cannot be read:
// a directory a container writes into must belong to the tenant, not to root.
func (s *Server) tenantIDs(ctx context.Context, username string) string {
	if username == "" || s.host.Mode() != "real" {
		return ""
	}
	uidOut, err := s.host.Runner.Run(ctx, "", "id", "-u", username)
	if err != nil {
		return ""
	}
	gidOut, err := s.host.Runner.Run(ctx, "", "id", "-g", username)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(uidOut) + ":" + strings.TrimSpace(gidOut)
}
