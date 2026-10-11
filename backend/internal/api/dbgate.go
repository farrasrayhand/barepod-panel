package api

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/dbengine"
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
	case "postgresql":
		return "postgres@dbgate-plugin-postgres", nil
	case "mysql":
		return "mysql@dbgate-plugin-mysql", nil
	case "mariadb":
		return "mariadb@dbgate-plugin-mysql", nil
	case "sqlite":
		return "sqlite@dbgate-plugin-sqlite", nil
	case "mongodb":
		return "mongo@dbgate-plugin-mongo", nil
	case "redis":
		return "redis@dbgate-plugin-redis", nil
	}
	return "", fmt.Errorf("DbGate does not open %s databases here", engine)
}

// dbgateSocketDir is the host directory holding an engine's unix socket, which is
// what has to be mounted into the DbGate container for a host-installed engine.
func dbgateSocketDir(engine string) string {
	switch engine {
	case "postgresql":
		return "/var/run/postgresql"
	case "mysql", "mariadb":
		return "/run/mysqld"
	}
	return ""
}

// dbgateSocketPath is the socket DbGate is told to connect over. PostgreSQL takes
// the directory (libpq appends ".s.PGSQL.<port>"); MySQL/MariaDB take the file.
func dbgateSocketPath(engine string) string {
	if engine == "postgresql" {
		return "/var/run/postgresql"
	}
	return "/run/mysqld/mysqld.sock"
}

// dbgateReach explains why DbGate cannot open an engine at all, so the tool list can
// say it instead of starting a container whose connection is refused: DbGate runs as
// a container, and an engine installed on the host listens on the host's loopback
// only. It can be reached over the engine's unix socket (mounted in) or, when the
// panel runs the engine itself, through the docker gateway — nothing else.
func dbgateReach(engine dbengine.Engine) (string, bool) {
	if engine.FileBased || engine.Mode == dbengine.ModeDocker || dbgateSocketDir(engine.Name) != "" {
		return "", false
	}
	return fmt.Sprintf("DbGate runs as a container and cannot reach %s, which listens on the host's loopback only and has no unix socket to mount — use the panel's own browser or a manager that runs on the host", engine.Label), true
}

// prepareDbGate writes the env file that scopes one DbGate container to this
// database: a single preconfigured connection (so there is nothing to type), no
// auth of its own — the panel session is the door — and WEB_ROOT so the container
// serves under the panel's own mount.
func (s *Server) prepareDbGate(ctx context.Context, record *store.Database, mount string, engine dbengine.Engine) (dbgatePlan, error) {
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
		lines = append(lines,
			"USER_bpod="+record.User,
			"PASSWORD_bpod="+password,
			"DATABASE_bpod="+record.Name,
		)
		switch {
		case engine.Mode == dbengine.ModeDocker:
			// DbGate is a container, so 127.0.0.1 inside it is its own loopback and not
			// the host's. An engine the panel runs as a container shares the host network,
			// so it is reached through the docker bridge gateway instead.
			host := s.containerGateway(ctx)
			if host == "" {
				host = "127.0.0.1"
			}
			lines = append(lines, "SERVER_bpod="+host, "PORT_bpod="+strconv.Itoa(record.Port))
		case dbgateSocketDir(engine.Name) != "":
			// An engine installed on the host listens on the host's loopback, which a
			// container cannot reach. Its unix socket is mounted in instead — the same
			// door the panel's own plans use — and DbGate is told to connect over it.
			dir := dbgateSocketDir(engine.Name)
			plan.volumes = append(plan.volumes, dir+":"+dir+":ro")
			// DbGate reads any connection field from env through this prefix, which is
			// how a field the plain SERVER/PORT set does not cover (the plugin's own
			// authType and socketPath) gets in: "CONNECTION_<id>_<field>".
			lines = append(lines,
				"CONNECTION_bpod_authType=socket",
				"CONNECTION_bpod_socketPath="+dbgateSocketPath(engine.Name),
			)
		default:
			lines = append(lines, "SERVER_bpod=127.0.0.1", "PORT_bpod="+strconv.Itoa(record.Port))
		}
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
