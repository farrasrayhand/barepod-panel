package api

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

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
//
// Whether that last door is open is *measured*, not assumed. An engine bound to the gateway
// address as well as loopback answers a container on the gateway, and then there is nothing to
// refuse; an engine bound to 127.0.0.1 alone is still refused, with the reason below. Measured on
// the test host: Redis bound to `127.0.0.1 -::1 172.17.0.1` answers on the gateway, so its cache
// can be opened in DbGate — its own plugin has no socket support at all (its connection fields
// are server, port, user, password and url), which is why the socket door is not the answer here.
func (s *Server) dbgateReach(ctx context.Context, engine dbengine.Engine, record *store.Database) (string, bool) {
	if engine.FileBased || engine.Mode == dbengine.ModeDocker || dbgateSocketDir(engine.Name) != "" {
		return "", false
	}
	if record != nil && record.Port > 0 && s.reachesGateway(ctx, record.Port) {
		return "", false
	}
	return fmt.Sprintf("DbGate runs as a container and cannot reach %s, which listens on the host's loopback only and has no unix socket to mount — use the panel's own browser or a manager that runs on the host", engine.Label), true
}

// reachesGateway reports whether a container could open this port. The docker gateway is the one
// address a container has to the host, so a listener bound there answers here; anything bound to
// loopback alone does not, which is exactly the question being asked.
func (s *Server) reachesGateway(ctx context.Context, port int) bool {
	host := s.containerGateway(ctx)
	if host == "" {
		return false
	}
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(port)), 700*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
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
			// A host engine the container can reach is given the gateway, because 127.0.0.1 inside
			// the container is the container itself. Measured, not assumed: if it only answers on
			// loopback, the refusal above has already explained why and this stays as it was.
			host := "127.0.0.1"
			if record.Port > 0 && s.reachesGateway(ctx, record.Port) {
				if gateway := s.containerGateway(ctx); gateway != "" {
					host = gateway
				}
			}
			lines = append(lines, "SERVER_bpod="+host, "PORT_bpod="+strconv.Itoa(record.Port))
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
