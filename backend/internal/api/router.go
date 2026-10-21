// Package api wires the HTTP router, middleware and handlers of the daemon.
package api

import (
	"encoding/json"
	"log"
	"net"
	"net/http"
	"net/http/pprof"
	"os"
	"os/exec"
	"path/filepath"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/config"
	"github.com/farrasrayhand/barepod-panel/backend/internal/dbengine"
	"github.com/farrasrayhand/barepod-panel/backend/internal/dbtools"
	"github.com/farrasrayhand/barepod-panel/backend/internal/deploy"
	"github.com/farrasrayhand/barepod-panel/backend/internal/guard"
	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/metrics"
	"github.com/farrasrayhand/barepod-panel/backend/internal/rbac"
	"github.com/farrasrayhand/barepod-panel/backend/internal/stack"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/telemetry"
	"github.com/farrasrayhand/barepod-panel/backend/internal/tenant"
	"github.com/farrasrayhand/barepod-panel/backend/internal/webserver"
)

// Version is the panel/daemon version matching GitHub release tag.
// It can be injected at build time using -ldflags="-X 'github.com/farrasrayhand/barepod-panel/backend/internal/api.Version=...'".
var Version = "0.4.3"

// Deps are the dependencies the HTTP layer needs.
type Deps struct {
	Config         config.Config
	Store          *store.Store
	Key            []byte
	Host           *host.Host
	Deploy         *deploy.Manager
	Tenants        *tenant.Manager
	Metrics        *metrics.Sampler
	SiteMetrics    *metrics.SiteSampler
	MetricsDB      *metrics.Persistence
	MaxUploadBytes int64
	// Tools is the supervisor for the on-demand database managers. Nil means no
	// manager can be hosted (the gate still reports honestly).
	Tools *dbtools.Supervisor
	// Guard is the brute-force lockout. Nil means none is running, and the endpoints
	// say so rather than reporting a protection that does not exist.
	Guard *guard.Guard
	// LookPath finds a tool's binary; nil means exec.LookPath (tests inject one so
	// availability does not depend on the machine).
	LookPath func(string) (string, error)
}

// Server holds the handler dependencies.
type Server struct {
	cfg         config.Config
	store       *store.Store
	key         []byte
	host        *host.Host
	deploy      *deploy.Manager
	tenants     *tenant.Manager
	metrics     *metrics.Sampler
	siteMetrics *metrics.SiteSampler
	metricsDB   *metrics.Persistence
	// publicIP is cached so the sidebar and settings do not call an echo service on every render.
	publicIPMu     sync.Mutex
	publicIP       string
	publicIPSource string
	publicIPAt     time.Time
	tickets        *ticketStore
	maxUploadBytes int64
	// engines is the single-flight orchestrator for containerised engines.
	engines engineOrchestrator
	// tools runs the on-demand database managers, and lookPath decides whether one
	// is offered at all.
	tools    *dbtools.Supervisor
	lookPath func(string) (string, error)
	// installs runs the Stack's allowlisted host installs (web server, PHP, Node…).
	installs *stack.Installer
	// guard is the brute-force lockout watching the engines' logs.
	guard *guard.Guard
	// telemetry aggregates real access logs and visitor GeoIP data.
	telemetry *telemetry.Service
	// guiMu serialises switching a manager between databases; guiServed records
	// which database each running manager is scoped to.
	guiMu     sync.Mutex
	guiServed map[string]string
	// guiStarting marks a manager whose `docker run` is in flight, so a page reloading while it
	// boots does not start a second one; guiStartReason is the last reason a start gave, which the
	// waiting page prints instead of a bare spinner.
	guiStarting    map[string]bool
	guiStartReason map[string]string
	// engineMu guards engineCache, a short-lived memory of what a detection found:
	// every request under a manager's mount asks which mode its engine is in, and a
	// full detection (docker info plus a probe per engine) on each of them is what
	// made a page crawl.
	engineMu    sync.Mutex
	engineCache map[string]cachedEngine
	// engineStateMu guards engineStates: the last verdict about a database record — whether the
	// engine has it and whether it accepts the stored credential. Kept so a listing does not ping
	// every engine each time the page is opened.
	engineStateMu sync.Mutex
	engineStates  map[string]engineStateEntry
}

type engineStateEntry struct {
	missing   bool
	suggested string
	rejected  bool
	at        time.Time
}

// engineCacheTTL is how long a detection is trusted. Short enough that an engine
// coming up or going down is noticed, long enough that a page's requests collapse
// into one detection.
const engineCacheTTL = 10 * time.Second

type cachedEngine struct {
	engine dbengine.Engine
	at     time.Time
}

// New builds the daemon HTTP handler.
func New(d Deps) http.Handler {
	maxUpload := d.MaxUploadBytes
	if maxUpload <= 0 {
		maxUpload = 64 << 20 // 64 MiB default
	}
	lookPath := d.LookPath
	if lookPath == nil {
		lookPath = exec.LookPath
	}
	s := &Server{
		cfg:            d.Config,
		store:          d.Store,
		key:            d.Key,
		host:           d.Host,
		deploy:         d.Deploy,
		tenants:        d.Tenants,
		metrics:        d.Metrics,
		siteMetrics:    d.SiteMetrics,
		metricsDB:      d.MetricsDB,
		tickets:        newTicketStore(),
		maxUploadBytes: maxUpload,
		tools:          d.Tools,
		lookPath:       lookPath,
		guard:          d.Guard,
		installs:       stack.New(d.Store, d.Host),
		telemetry:      telemetry.NewService(d.Store),
	}

	go s.reconcileWebsiteTunnelRoutes()
	go s.reconcileRedisCaches()

	mux := http.NewServeMux()

	// Public
	mux.HandleFunc("GET /api/v1/health", s.handleHealth)
	mux.HandleFunc("POST /api/v1/auth/login", s.handleLogin)

	// Session & account
	mux.HandleFunc("POST /api/v1/auth/logout", s.requireAuth(s.handleLogout))
	mux.HandleFunc("GET /api/v1/auth/me", s.requireAuth(s.handleMe))
	mux.HandleFunc("POST /api/v1/auth/verify", s.requireAuth(s.handleVerify))
	mux.HandleFunc("POST /api/v1/auth/password", s.requireAuth(s.handleChangePassword))

	// Two-factor authentication for the signed-in account. Enrolment only takes effect once a code
	// confirms it, and the secret is encrypted like every other secret.
	mux.HandleFunc("GET /api/v1/auth/totp", s.requireAuth(s.handleTOTPStatus))
	mux.HandleFunc("POST /api/v1/auth/totp/setup", s.requireAuth(s.handleTOTPSetup))
	mux.HandleFunc("POST /api/v1/auth/totp/enable", s.requireAuth(s.handleTOTPEnable))
	mux.HandleFunc("POST /api/v1/auth/totp/disable", s.requireAuth(s.handleTOTPDisable))
	mux.HandleFunc("GET /api/v1/sessions", s.requireAuth(s.handleListSessions))
	mux.HandleFunc("DELETE /api/v1/sessions/{id}", s.requireAuth(s.handleRevokeSession))
	mux.HandleFunc("GET /api/v1/audit", s.requireAuth(s.handleListAudit))

	// Permission groups / tenant packages (the only built-in data) — "users" capability
	users := func(h authedHandler) http.HandlerFunc {
		return s.requireAuth(s.requireCapability(rbac.CapUsers, h))
	}
	mux.HandleFunc("GET /api/v1/groups", users(s.handleListGroups))
	mux.HandleFunc("POST /api/v1/groups", users(s.handleCreateGroup))
	mux.HandleFunc("PATCH /api/v1/groups/{name}", users(s.handleUpdateGroup))
	mux.HandleFunc("DELETE /api/v1/groups/{name}", users(s.handleDeleteGroup))
	mux.HandleFunc("GET /api/v1/system/capacity", users(s.handleCapacity))

	// Accounts. Creating one also creates the Linux account behind it and applies the
	// package's disk/inode quota; deleting one that still owns resources is refused.
	mux.HandleFunc("GET /api/v1/users", users(s.handleListUsers))
	mux.HandleFunc("POST /api/v1/users", users(s.handleCreateUser))
	mux.HandleFunc("PATCH /api/v1/users/{id}", users(s.handleUpdateUser))
	mux.HandleFunc("DELETE /api/v1/users/{id}", users(s.handleDeleteUser))
	mux.HandleFunc("POST /api/v1/users/{id}/password", users(s.handleResetUserPassword))
	mux.HandleFunc("POST /api/v1/users/{id}/provision", users(s.handleProvisionUser))

	// The Stack: host-level platform choices (the web server ingress, database/PHP/Node
	// versions). Reading it is for anyone signed in; changing and installing are
	// administrative and audited.
	mux.HandleFunc("GET /api/v1/system/stack", s.requireAuth(s.handleStackStatus))
	mux.HandleFunc("PUT /api/v1/system/stack/web-server", users(s.handleSetWebServer))
	mux.HandleFunc("POST /api/v1/system/stack/install", users(s.handleStackInstall))
	mux.HandleFunc("POST /api/v1/system/stack/uninstall", users(s.handleStackUninstall))
	mux.HandleFunc("POST /api/v1/system/stack/repair", users(s.handleStackRepair))
	// The dry run: what a switch or removal would do, without doing any of it.
	mux.HandleFunc("GET /api/v1/system/stack/plan", s.requireAuth(s.handleStackPlan))
	mux.HandleFunc("GET /api/v1/system/stack/jobs/stream", users(s.handleStackJobStream))
	mux.HandleFunc("GET /api/v1/system/stack/jobs/{id}", users(s.handleStackJob))

	// PHP extensions: what this host really has for a version, and the switch that turns
	// one on or off (phpenmod / phpdismod). Reading is for anyone signed in; changing is
	// administrative and audited.
	mux.HandleFunc("GET /api/v1/system/php/extensions", s.requireAuth(s.handlePhpExtensions))
	mux.HandleFunc("POST /api/v1/system/php/extensions", users(s.handleSetPhpExtension))
	mux.HandleFunc("POST /api/v1/system/php/extensions/install", users(s.handleInstallPhpExtensions))

	// Brute-force lockout. Reading it is for anyone signed in — knowing that the panel keeps
	// brute-force out is not a secret, and a card nobody can see is a card nobody uses.
	// Changing the numbers, and letting an address back in, are administrative acts and are
	// audited.
	mux.HandleFunc("GET /api/v1/system/guard", s.requireAuth(s.handleGuardStatus))
	mux.HandleFunc("PATCH /api/v1/system/guard", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleGuardSettings)))
	mux.HandleFunc("POST /api/v1/system/guard/unban", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleGuardUnban)))

	// Panel-wide settings. The one that matters today is the address an external client should use:
	// the daemon cannot detect it (behind NAT there is nothing to detect), so the operator sets it
	// and every snippet prefers it.
	mux.HandleFunc("GET /api/v1/system/public-ip", s.requireAuth(s.handlePublicIP))
	mux.HandleFunc("GET /api/v1/system/settings", s.requireAuth(s.handlePanelSettings))
	mux.HandleFunc("PATCH /api/v1/system/settings", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleSavePanelSettings)))
	mux.HandleFunc("GET /api/v1/system/settings/php-defaults", s.requireAuth(s.handleGetPhpDefaults))
	mux.HandleFunc("PUT /api/v1/system/settings/php-defaults", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleSavePhpDefaults)))

	// Alert channels the maintenance jobs report through. Reading is open to any signed-in user
	// (secrets are masked); changing or testing them is administrative.
	mux.HandleFunc("GET /api/v1/system/notifications", s.requireAuth(s.handleGetNotifications))
	mux.HandleFunc("PUT /api/v1/system/notifications", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleSaveNotifications)))
	mux.HandleFunc("POST /api/v1/system/notifications/test", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleTestNotification)))

	// The host clock. Reading it is open to any signed-in user; moving the host's timezone is not.
	mux.HandleFunc("GET /api/v1/system/time", s.requireAuth(s.handleGetSystemTime))
	mux.HandleFunc("POST /api/v1/system/time", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleSetSystemTimezone)))

	// In-Panel Self-Update & Over-The-Air (OTA) engine. Reading update status is accessible to
	// operators; applying an update requires administrative capability (CapUsers) and audit.
	mux.HandleFunc("GET /api/v1/system/updates/check", s.requireAuth(s.handleCheckUpdates))
	mux.HandleFunc("POST /api/v1/system/updates/apply", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleApplyUpdate)))
	mux.HandleFunc("GET /api/v1/system/updates/stream", s.requireAuth(s.handleUpdateStream))

	// The ports this host is actually listening on, because the settings screen used to have them
	// written into it — including none for SSH.
	mux.HandleFunc("GET /api/v1/system/ports", s.requireAuth(s.handleSystemPorts))

	// Changing a port the host itself listens on. Administrative, audited, and written the same way in
	// both: validate, keep a copy, write, verify, and put the copy back if the verification fails.
	mux.HandleFunc("POST /api/v1/system/ports/panel", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleSetPanelPort)))
	mux.HandleFunc("POST /api/v1/system/ports/ssh", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleSetSSHPort)))

	// System — "monitoring" capability
	mux.HandleFunc("GET /api/v1/system/capabilities", s.requireAuth(s.requireCapability(rbac.CapMonitoring, s.handleCapabilities)))
	mux.HandleFunc("GET /api/v1/system/metrics", s.requireAuth(s.requireCapability(rbac.CapMonitoring, s.handleSystemMetrics)))
	mux.HandleFunc("GET /api/v1/system/metrics/daemon", s.requireAuth(s.requireCapability(rbac.CapMonitoring, s.handleDaemonMetrics)))
	mux.HandleFunc("GET /api/v1/system/processes", s.requireAuth(s.requireCapability(rbac.CapMonitoring, s.handleSystemProcesses)))
	mux.HandleFunc("POST /api/v1/system/processes/{pid}/kill", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleSystemProcessKill)))
	mux.HandleFunc("GET /api/v1/system/services", s.requireAuth(s.requireCapability(rbac.CapMonitoring, s.handleSystemServices)))
	mux.HandleFunc("POST /api/v1/system/services/{unit}/action", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleSystemServiceAction)))
	mux.HandleFunc("GET /api/v1/system/services/{unit}/logs", s.requireAuth(s.requireCapability(rbac.CapMonitoring, s.handleSystemServiceLogs)))
	mux.HandleFunc("GET /api/v1/system/storage", s.requireAuth(s.requireCapability(rbac.CapMonitoring, s.handleSystemStorage)))
	mux.HandleFunc("GET /api/v1/system/network", s.requireAuth(s.requireCapability(rbac.CapMonitoring, s.handleSystemNetwork)))
	mux.HandleFunc("POST /api/v1/system/network/ping", s.requireAuth(s.requireCapability(rbac.CapMonitoring, s.handleSystemPing)))
	mux.HandleFunc("GET /api/v1/system/autotune", s.requireAuth(s.handleGetAutoTune))
	mux.HandleFunc("POST /api/v1/system/autotune", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleApplyAutoTune)))
	mux.HandleFunc("POST /api/v1/ws/ticket", s.requireAuth(s.handleWSTicket))

	// Interactive terminals. Auth uses the one-time ticket (never a long-lived
	// token in the URL); the handlers re-check capability and ownership.
	mux.HandleFunc("GET /api/v1/websites/{slug}/pty", s.handleWebsitePTY)
	mux.HandleFunc("GET /api/v1/system/pty", s.handleHostPTY)

	// Websites — "deployApps" capability, scoped to the caller's own websites
	// (admins see every tenant).
	deploy := func(h authedHandler) http.HandlerFunc {
		return s.requireAuth(s.requireCapability(rbac.CapDeployApps, h))
	}
	mux.HandleFunc("GET /api/v1/websites", deploy(s.handleListWebsites))
	mux.HandleFunc("POST /api/v1/websites", deploy(s.handleCreateWebsite))
	mux.HandleFunc("POST /api/v1/websites/prepare-directory", deploy(s.handlePrepareDirectory))
	mux.HandleFunc("GET /api/v1/websites/{slug}", deploy(s.handleGetWebsite))
	// The site's real .env (secrets masked): what the application actually connects to.
	mux.HandleFunc("GET /api/v1/websites/{slug}/env", deploy(s.handleWebsiteEnv))
	mux.HandleFunc("GET /api/v1/websites/{slug}/logs", deploy(s.handleWebsiteLogs))
	// Path routes: real vhost entries, not a client-side mock.
	mux.HandleFunc("GET /api/v1/websites/{slug}/routes", deploy(s.handleListWebsiteRoutes))
	mux.HandleFunc("POST /api/v1/websites/{slug}/routes", deploy(s.handleCreateWebsiteRoute))
	mux.HandleFunc("PUT /api/v1/websites/{slug}/routes/{id}", deploy(s.handleUpdateWebsiteRoute))
	mux.HandleFunc("DELETE /api/v1/websites/{slug}/routes/{id}", deploy(s.handleDeleteWebsiteRoute))
	mux.HandleFunc("GET /api/v1/websites/{slug}/detect-framework", deploy(s.handleDetectWebsiteFramework))
	mux.HandleFunc("PUT /api/v1/websites/{slug}/framework", deploy(s.handleUpdateWebsiteFramework))
	mux.HandleFunc("POST /api/v1/websites/detect-framework", deploy(s.handleDetectFrameworkFromSource))
	mux.HandleFunc("DELETE /api/v1/websites/{slug}", deploy(s.handleDeleteWebsite))
	mux.HandleFunc("POST /api/v1/websites/{slug}/redeploy", deploy(s.handleRedeployWebsite))
	mux.HandleFunc("POST /api/v1/websites/{slug}/exec", deploy(s.handleWebsiteExecCommand))
	mux.HandleFunc("POST /api/v1/websites/{slug}/ping", deploy(s.handlePingWebsite))
	mux.HandleFunc("GET /api/v1/websites/{slug}/deploy", deploy(s.handleLatestDeploy))
	// The literal path is more specific than the {id} pattern below; Go's ServeMux routes it first.
	mux.HandleFunc("GET /api/v1/websites/{slug}/deploy/history", deploy(s.handleDeployHistory))
	mux.HandleFunc("GET /api/v1/websites/{slug}/deploy/stream", deploy(s.handleDeployStream))
	mux.HandleFunc("GET /api/v1/websites/{slug}/deploy/{id}", deploy(s.handleDeployJob))
	mux.HandleFunc("GET /api/v1/websites/{slug}/metrics", deploy(s.handleWebsiteMetrics))
	mux.HandleFunc("GET /api/v1/websites/{slug}/telemetry", deploy(s.handleWebsiteTelemetry))
	mux.HandleFunc("GET /api/v1/websites/{slug}/telemetry/stream", deploy(s.handleWebsiteTelemetryStream))
	mux.HandleFunc("GET /api/v1/websites/{slug}/runtime", deploy(s.handleGetRuntime))
	mux.HandleFunc("PUT /api/v1/websites/{slug}/runtime", deploy(s.handlePutRuntime))
	mux.HandleFunc("GET /api/v1/websites/{slug}/vhost/preview", deploy(s.handleVhostPreview))
	mux.HandleFunc("POST /api/v1/websites/{slug}/php-fpm/reload", deploy(s.handlePhpFpmReload))
	mux.HandleFunc("GET /api/v1/websites/{slug}/runtime/config", deploy(s.handleGetRuntimeConfig))
	mux.HandleFunc("PUT /api/v1/websites/{slug}/runtime/config", deploy(s.handleSaveRuntimeConfig))
	mux.HandleFunc("GET /api/v1/websites/{slug}/php/ini", deploy(s.handleGetRuntimeConfig))
	mux.HandleFunc("PUT /api/v1/websites/{slug}/php/ini", deploy(s.handleSaveRuntimeConfig))
	mux.HandleFunc("GET /api/v1/websites/{slug}/secrets", deploy(s.handleListSecrets))
	mux.HandleFunc("POST /api/v1/websites/{slug}/secrets/{name}/reveal", deploy(s.handleRevealSecret))
	mux.HandleFunc("GET /api/v1/websites/{slug}/security", deploy(s.handleGetWebsiteSecurity))
	mux.HandleFunc("PUT /api/v1/websites/{slug}/security", deploy(s.handleSaveWebsiteSecurity))
	mux.HandleFunc("POST /api/v1/websites/{slug}/maintenance/toggle", deploy(s.handleToggleMaintenance))
	mux.HandleFunc("POST /api/v1/websites/{slug}/basic-auth/toggle", deploy(s.handleToggleBasicAuth))

	// Git Ingress, Deploy Keys & Webhooks
	mux.HandleFunc("GET /api/v1/websites/{slug}/git", deploy(s.handleGetWebsiteGit))
	mux.HandleFunc("GET /api/v1/websites/{slug}/git/deploy-key", deploy(s.handleGetDeployKey))
	mux.HandleFunc("POST /api/v1/websites/{slug}/git/deploy-key/rotate", deploy(s.handleRotateDeployKey))
	mux.HandleFunc("POST /api/v1/websites/{slug}/git/auto-deploy", deploy(s.handleSetWebsiteAutoDeploy))
	mux.HandleFunc("POST /api/v1/websites/{slug}/git/check", deploy(s.handleCheckWebsiteGit))
	mux.HandleFunc("PATCH /api/v1/websites/{slug}/git", deploy(s.handleUpdateWebsiteGit))
	mux.HandleFunc("PUT /api/v1/websites/{slug}/git", deploy(s.handleUpdateWebsiteGit))
	mux.HandleFunc("POST /api/v1/webhooks/deploy/{slug}", s.handlePublicDeployWebhook)
	mux.HandleFunc("POST /api/v1/webhook/{slug}/deploy", s.handlePublicDeployWebhook)

	// User Git Providers
	mux.HandleFunc("GET /api/v1/git/providers", s.requireAuth(s.handleListUserGitProviders))
	mux.HandleFunc("POST /api/v1/git/providers", s.requireAuth(s.handleCreateUserGitProvider))
	mux.HandleFunc("POST /api/v1/git/providers/test", s.requireAuth(s.handleTestUserGitProvider))
	mux.HandleFunc("GET /api/v1/git/providers/{id}/repos", s.requireAuth(s.handleListGitProviderRepos))
	mux.HandleFunc("GET /api/v1/git/providers/{id}/branches", s.requireAuth(s.handleListGitProviderBranches))
	mux.HandleFunc("DELETE /api/v1/git/providers/{id}", s.requireAuth(s.handleDeleteUserGitProvider))

	// Me Git Providers Aliases (per API Contract)
	mux.HandleFunc("GET /api/v1/me/git/providers", s.requireAuth(s.handleListUserGitProviders))
	mux.HandleFunc("POST /api/v1/me/git/providers", s.requireAuth(s.handleCreateUserGitProvider))
	mux.HandleFunc("POST /api/v1/me/git/providers/test", s.requireAuth(s.handleTestUserGitProvider))
	mux.HandleFunc("GET /api/v1/me/git/providers/{id}/repos", s.requireAuth(s.handleListGitProviderRepos))
	mux.HandleFunc("GET /api/v1/me/git/providers/{id}/branches", s.requireAuth(s.handleListGitProviderBranches))
	mux.HandleFunc("DELETE /api/v1/me/git/providers/{id}", s.requireAuth(s.handleDeleteUserGitProvider))

	// Unified Cron Jobs (Settings & per-website)
	mux.HandleFunc("GET /api/v1/cron/jobs", s.requireAuth(s.handleListCronJobs))
	mux.HandleFunc("POST /api/v1/cron/jobs", s.requireAuth(s.handleCreateCronJob))
	mux.HandleFunc("PUT /api/v1/cron/jobs/{id}", s.requireAuth(s.handleUpdateCronJob))
	mux.HandleFunc("DELETE /api/v1/cron/jobs/{id}", s.requireAuth(s.handleDeleteCronJob))
	mux.HandleFunc("POST /api/v1/cron/jobs/{id}/run", s.requireAuth(s.handleRunCronJob))
	// Built-in maintenance jobs: the daemon runs these itself, so changing or forcing one is
	// administrative.
	mux.HandleFunc("PUT /api/v1/cron/jobs/system/{id}", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleUpdateSystemCronJob)))
	mux.HandleFunc("POST /api/v1/cron/jobs/system/{id}/run", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleRunSystemCronJob)))
	mux.HandleFunc("GET /api/v1/websites/{slug}/cron", deploy(s.handleListCronJobs))
	mux.HandleFunc("POST /api/v1/websites/{slug}/cron", deploy(s.handleCreateCronJob))

	for _, action := range []string{"start", "stop", "restart"} {
		act := action
		mux.HandleFunc("POST /api/v1/websites/{slug}/"+act, deploy(
			func(w http.ResponseWriter, r *http.Request, user *store.User, sess *store.Session) {
				s.handleWebsiteAction(w, r, user, sess, act)
			}))
	}

	// File manager — "fileManager" capability, scoped to the caller's own site.
	files := func(h authedHandler) http.HandlerFunc {
		return s.requireAuth(s.requireCapability(rbac.CapFileManager, h))
	}
	mux.HandleFunc("GET /api/v1/websites/{slug}/files", files(s.handleListFiles))
	mux.HandleFunc("GET /api/v1/websites/{slug}/files/content", files(s.handleReadFile))
	mux.HandleFunc("PUT /api/v1/websites/{slug}/files/content", files(s.handleWriteFile))
	mux.HandleFunc("GET /api/v1/websites/{slug}/files/download", files(s.handleDownloadFile))
	mux.HandleFunc("POST /api/v1/websites/{slug}/files/upload", files(s.handleUploadFiles))
	mux.HandleFunc("POST /api/v1/websites/{slug}/files/create", files(s.handleCreateFile))
	mux.HandleFunc("POST /api/v1/websites/{slug}/files/mkdir", files(s.handleMkdir))
	mux.HandleFunc("POST /api/v1/websites/{slug}/files/rename", files(s.handleRenameFiles))
	mux.HandleFunc("POST /api/v1/websites/{slug}/files/copy", files(s.handleCopyFiles))
	mux.HandleFunc("POST /api/v1/websites/{slug}/files/move", files(s.handleMoveFiles))
	mux.HandleFunc("POST /api/v1/websites/{slug}/files/delete", files(s.handleDeleteFiles))
	mux.HandleFunc("POST /api/v1/websites/{slug}/files/compress", files(s.handleCompressFiles))
	mux.HandleFunc("POST /api/v1/websites/{slug}/files/extract", files(s.handleExtractFiles))
	mux.HandleFunc("POST /api/v1/websites/{slug}/files/upload-chunk", files(s.handleUploadChunk))
	mux.HandleFunc("GET /api/v1/websites/{slug}/files/upload-chunk", files(s.handleUploadChunkStatus))

	// Host-wide browser. An admin may look anywhere; the daemon enforces that the
	// system trees (/etc, /usr, /boot, /var/lib, /proc, /sys, …) are read-only, so
	// a panel can never brick its own machine by mistake.
	mux.HandleFunc("GET /api/v1/files", files(s.handleScopedList))
	mux.HandleFunc("GET /api/v1/files/content", files(s.handleScopedRead))
	mux.HandleFunc("PUT /api/v1/files/content", files(s.handleScopedWrite))
	mux.HandleFunc("GET /api/v1/files/download", files(s.handleScopedDownload))
	mux.HandleFunc("POST /api/v1/files/upload", files(s.handleScopedUpload))
	mux.HandleFunc("POST /api/v1/files/create", files(s.handleScopedCreate))
	mux.HandleFunc("POST /api/v1/files/mkdir", files(s.handleScopedMkdir))
	mux.HandleFunc("POST /api/v1/files/rename", files(s.handleScopedRename))
	mux.HandleFunc("POST /api/v1/files/copy", files(func(w http.ResponseWriter, r *http.Request, user *store.User, sess *store.Session) {
		s.handleScopedTransfer(w, r, user, "copy")
	}))
	mux.HandleFunc("POST /api/v1/files/move", files(func(w http.ResponseWriter, r *http.Request, user *store.User, sess *store.Session) {
		s.handleScopedTransfer(w, r, user, "move")
	}))
	mux.HandleFunc("POST /api/v1/files/delete", files(s.handleScopedDelete))
	mux.HandleFunc("POST /api/v1/files/compress", files(s.handleScopedCompress))
	mux.HandleFunc("POST /api/v1/files/extract", files(s.handleScopedExtract))
	mux.HandleFunc("POST /api/v1/files/upload-chunk", files(s.handleScopedUploadChunk))
	mux.HandleFunc("GET /api/v1/files/upload-chunk", files(s.handleScopedUploadChunkStatus))
	// The picker behind the host-wide browser: which accounts have a home.
	mux.HandleFunc("GET /api/v1/tenants", files(s.handleListTenants))

	// Databases and caches: one ledger, two families (a cache is a database with
	// different commands). "databases" capability; reveals need elevated mode.
	databases := func(h authedHandler) http.HandlerFunc {
		return s.requireAuth(s.requireCapability(rbac.CapDatabases, h))
	}
	mux.HandleFunc("GET /api/v1/db-engines", databases(s.handleDbEngines))

	mux.HandleFunc("GET /api/v1/databases", databases(s.handleListDatabases(store.KindDatabase)))
	mux.HandleFunc("POST /api/v1/databases", databases(s.handleCreateDatabase(store.KindDatabase)))
	mux.HandleFunc("GET /api/v1/databases/recycle-bin", databases(s.handleListRecycleBin(store.KindDatabase)))
	mux.HandleFunc("DELETE /api/v1/databases/recycle-bin", databases(s.handleEmptyRecycleBin(store.KindDatabase)))
	mux.HandleFunc("GET /api/v1/databases/{id}", databases(s.handleGetDatabase(store.KindDatabase)))
	mux.HandleFunc("PATCH /api/v1/databases/{id}", databases(s.handlePatchDatabase(store.KindDatabase)))
	mux.HandleFunc("DELETE /api/v1/databases/{id}", databases(s.handleBinDatabase(store.KindDatabase)))
	mux.HandleFunc("POST /api/v1/databases/{id}/rotate-password", databases(s.handleRotateDatabasePassword(store.KindDatabase)))
	mux.HandleFunc("POST /api/v1/databases/{id}/reveal", databases(s.handleRevealDatabase(store.KindDatabase)))
	mux.HandleFunc("GET /api/v1/databases/{id}/connection-string", databases(s.handleConnectionString(store.KindDatabase)))
	mux.HandleFunc("GET /api/v1/databases/{id}/export", databases(s.handleExportDatabase(store.KindDatabase)))
	// Exposure: opening a database's port to the outside, which the daemon refuses while it
	// cannot keep brute-force out, and the engine's own log, which explains what happened.
	// Both are registered for caches as well: a cache is the same record with a different
	// engine, and the screen that shows it asks the same questions.
	mux.HandleFunc("POST /api/v1/databases/{id}/exposure", databases(s.handleSetExposure(store.KindDatabase)))
	mux.HandleFunc("GET /api/v1/databases/{id}/log", databases(s.handleDatabaseLog(store.KindDatabase)))
	mux.HandleFunc("POST /api/v1/databases/{id}/restore", databases(s.handleRestoreDatabase(store.KindDatabase)))
	mux.HandleFunc("POST /api/v1/databases/{id}/purge", databases(s.handlePurgeDatabase(store.KindDatabase)))
	// Data browsing, served by the daemon itself: no extra port, no GUI process —
	// the panel's own session, capability and audit apply.
	mux.HandleFunc("GET /api/v1/databases/{id}/tables", databases(s.handleListTables(store.KindDatabase)))
	mux.HandleFunc("POST /api/v1/databases/{id}/query", databases(s.handleDatabaseQuery(store.KindDatabase)))
	// Managers live behind the panel's own session: no port, no direct link.
	mux.HandleFunc("GET /api/v1/databases/{id}/gui", databases(s.handleDatabaseGui(store.KindDatabase)))
	mux.HandleFunc("GET /api/v1/databases/{id}/gui/{tool}", databases(s.handleDatabaseGui(store.KindDatabase)))
	// The manager's own pages and assets run under the same session. Its client
	// cannot carry our CSRF header, so this subtree validates the session without
	// it and the handler issues a path-scoped SameSite=Strict cookie instead.
	proxy := func(h authedHandler) http.HandlerFunc {
		return s.requireSession(false, s.requireCapability(rbac.CapDatabases, h))
	}
	mux.HandleFunc("GET /api/v1/databases/{id}/gui/{tool}/{path...}", proxy(s.handleDatabaseGuiProxy(store.KindDatabase)))
	mux.HandleFunc("POST /api/v1/databases/{id}/gui/{tool}/{path...}", proxy(s.handleDatabaseGuiProxy(store.KindDatabase)))

	mux.HandleFunc("GET /api/v1/caches", databases(s.handleListDatabases(store.KindCache)))
	mux.HandleFunc("POST /api/v1/caches", databases(s.handleCreateDatabase(store.KindCache)))
	mux.HandleFunc("GET /api/v1/caches/recycle-bin", databases(s.handleListRecycleBin(store.KindCache)))
	mux.HandleFunc("DELETE /api/v1/caches/recycle-bin", databases(s.handleEmptyRecycleBin(store.KindCache)))
	mux.HandleFunc("GET /api/v1/caches/{id}", databases(s.handleGetDatabase(store.KindCache)))
	mux.HandleFunc("PATCH /api/v1/caches/{id}", databases(s.handlePatchDatabase(store.KindCache)))
	mux.HandleFunc("DELETE /api/v1/caches/{id}", databases(s.handleBinDatabase(store.KindCache)))
	mux.HandleFunc("POST /api/v1/caches/{id}/rotate-password", databases(s.handleRotateDatabasePassword(store.KindCache)))
	mux.HandleFunc("POST /api/v1/caches/{id}/reveal", databases(s.handleRevealDatabase(store.KindCache)))
	mux.HandleFunc("GET /api/v1/caches/{id}/connection-string", databases(s.handleConnectionString(store.KindCache)))
	mux.HandleFunc("POST /api/v1/caches/{id}/restore", databases(s.handleRestoreDatabase(store.KindCache)))
	mux.HandleFunc("POST /api/v1/caches/{id}/purge", databases(s.handlePurgeDatabase(store.KindCache)))
	mux.HandleFunc("GET /api/v1/caches/{id}/tables", databases(s.handleListTables(store.KindCache)))
	mux.HandleFunc("POST /api/v1/caches/{id}/query", databases(s.handleDatabaseQuery(store.KindCache)))
	mux.HandleFunc("GET /api/v1/caches/{id}/gui", databases(s.handleDatabaseGui(store.KindCache)))
	mux.HandleFunc("GET /api/v1/caches/{id}/gui/{tool}", databases(s.handleDatabaseGui(store.KindCache)))
	mux.HandleFunc("GET /api/v1/caches/{id}/gui/{tool}/{path...}", proxy(s.handleDatabaseGuiProxy(store.KindCache)))
	mux.HandleFunc("POST /api/v1/caches/{id}/gui/{tool}/{path...}", proxy(s.handleDatabaseGuiProxy(store.KindCache)))
	// The cache browser is ours: keys are read with the pure-Go client, so no
	// redis-cli (and no redis-commander) has to exist anywhere.
	mux.HandleFunc("GET /api/v1/caches/{id}/key", databases(s.handleRedisKey(store.KindCache)))
	// The same two questions the database family answers, for a cache: whether its port is
	// open, and what the engine said. Without these a cache's Logs tab answered "No such
	// record" for a record the panel itself was displaying.
	mux.HandleFunc("POST /api/v1/caches/{id}/exposure", databases(s.handleSetExposure(store.KindCache)))
	mux.HandleFunc("GET /api/v1/caches/{id}/log", databases(s.handleDatabaseLog(store.KindCache)))

	// Domains & SSL — "domains" capability
	domains := func(h authedHandler) http.HandlerFunc {
		return s.requireAuth(s.requireCapability(rbac.CapDomains, h))
	}
	mux.HandleFunc("GET /api/v1/domains", domains(s.handleListDomains))
	mux.HandleFunc("GET /api/v1/domains/validate", s.requireAuth(s.handleValidateDomain))
	mux.HandleFunc("POST /api/v1/domains", domains(s.handleAddDomain))
	mux.HandleFunc("PUT /api/v1/domains/{id}", domains(s.handleUpdateDomain))
	mux.HandleFunc("DELETE /api/v1/domains/{id}", domains(s.handleDeleteDomain))
	mux.HandleFunc("PUT /api/v1/websites/{slug}/domain", deploy(s.handleUpdateWebsiteDomain))
	mux.HandleFunc("POST /api/v1/domains/{id}/ssl/issue", domains(s.handleIssueSSL))
	mux.HandleFunc("POST /api/v1/domains/{id}/ssl/custom", domains(s.handleUploadCustomSSL))
	mux.HandleFunc("POST /api/v1/domains/{id}/ssl/toggle", domains(s.handleToggleSSL))

	// Cloudflare Tunnels (Zero-NAT) — "cloudflareTunnels" capability
	tunnels := func(h authedHandler) http.HandlerFunc {
		return s.requireAuth(s.requireCapability(rbac.CapCloudflareTunnels, h))
	}
	mux.HandleFunc("GET /api/v1/tunnels/status", tunnels(s.handleGetTunnelStatus))
	mux.HandleFunc("GET /api/v1/tunnels/zones", tunnels(s.handleListTunnelZones))
	mux.HandleFunc("POST /api/v1/tunnels/token", tunnels(s.handleSetTunnelToken))
	mux.HandleFunc("POST /api/v1/tunnels/unlink", tunnels(s.handleUnlinkTunnel))
	mux.HandleFunc("DELETE /api/v1/tunnels/connection", tunnels(s.handleUnlinkTunnel))
	mux.HandleFunc("POST /api/v1/tunnels/restart", tunnels(s.handleRestartTunnel))
	mux.HandleFunc("POST /api/v1/tunnels/sync", tunnels(s.handleSyncCloudflareRoutes))
	mux.HandleFunc("POST /api/v1/tunnels/routes", tunnels(s.handleAddTunnelRoute))
	mux.HandleFunc("PUT /api/v1/tunnels/routes/{id}", tunnels(s.handleUpdateTunnelRoute))
	mux.HandleFunc("DELETE /api/v1/tunnels/routes/{id}", tunnels(s.handleDeleteTunnelRoute))

	// The panel's own hostname, published through the admin's Cloudflare Tunnel. Admin only: the
	// panel's own domain must never be reachable through a tenant's account.
	mux.HandleFunc("GET /api/v1/panel/tunnel", s.requireAuth(s.handlePanelTunnelStatus))
	mux.HandleFunc("POST /api/v1/panel/tunnel/publish", s.requireAuth(s.handlePublishPanel))
	mux.HandleFunc("POST /api/v1/panel/tunnel/unpublish", s.requireAuth(s.handleUnpublishPanel))

	// Runtime profiles are for operators only: a heap or goroutine dump exposes
	// internal paths and memory contents. There is intentionally no UI link.
	pprofAdmin := func(h http.Handler) http.HandlerFunc {
		return s.requireAuth(s.requireCapability(rbac.CapUsers, func(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
			h.ServeHTTP(w, r)
		}))
	}
	mux.HandleFunc("GET /debug/pprof/", pprofAdmin(http.HandlerFunc(pprof.Index)))
	mux.HandleFunc("GET /debug/pprof/cmdline", pprofAdmin(http.HandlerFunc(pprof.Cmdline)))
	mux.HandleFunc("GET /debug/pprof/profile", pprofAdmin(http.HandlerFunc(pprof.Profile)))
	mux.HandleFunc("GET /debug/pprof/symbol", pprofAdmin(http.HandlerFunc(pprof.Symbol)))
	mux.HandleFunc("POST /debug/pprof/symbol", pprofAdmin(http.HandlerFunc(pprof.Symbol)))
	mux.HandleFunc("GET /debug/pprof/trace", pprofAdmin(http.HandlerFunc(pprof.Trace)))
	for _, name := range []string{"allocs", "block", "goroutine", "heap", "mutex", "threadcreate"} {
		name := name
		mux.HandleFunc("GET /debug/pprof/"+name, pprofAdmin(pprof.Handler(name)))
	}

	// Everything else: SPA (path-based routes need index.html fallback).
	mux.HandleFunc("/", s.handleSPA)

	return withRecovery(withLogging(s.panelAccessGuard(s.hostGuard(mux))))
}

// withRecovery keeps one bad request from taking the daemon down.
//
// A panic in a handler used to end the process: systemd restarted it, the frontend retried the
// same request, and after five rapid restarts systemd gave up — the panel stayed down. The
// control plane serves every site, so a crash here is an outage for all of them. This turns it
// into a logged 500 and leaves the rest of the daemon serving.
func withRecovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("api: panic serving %s %s: %v\n%s", r.Method, r.URL.Path, rec, debug.Stack())
				writeError(w, http.StatusInternalServerError, "internal", "The panel hit an internal error while handling this request")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// ---- helpers ----

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v != nil {
		if err := json.NewEncoder(w).Encode(v); err != nil {
			log.Printf("api: encode response: %v", err)
		}
	}
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]apiError{"error": {Code: code, Message: message}})
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	return dec.Decode(dst)
}

// handleSPA serves the built frontend, falling back to index.html so that
// deep links such as /websites/<name>/logs keep working on refresh.
func (s *Server) handleSPA(w http.ResponseWriter, r *http.Request) {
	// An unknown API route must not fall through to the SPA: a client asking for
	// JSON has to get a JSON 404, not a page.
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, "not_found", "API route not found")
		return
	}

	// Do not expose the panel SPA on hosted website domains.
	host := r.Host
	if h, _, err := net.SplitHostPort(r.Host); err == nil {
		host = h
	}
	host = strings.ToLower(strings.TrimSpace(host))
	if s.store != nil {
		if sites, err := s.store.ListWebsites(); err == nil {
			for _, site := range sites {
				if strings.EqualFold(site.Domain, host) {
					w.Header().Set("Content-Type", "text/html; charset=utf-8")
					w.Header().Set("Cache-Control", "no-store")
					w.WriteHeader(http.StatusNotFound)
					_, _ = w.Write([]byte(webserver.Default404HTML(host)))
					return
				}
			}
		}
	}

	index := filepath.Join(s.cfg.StaticDir, "index.html")
	if _, err := os.Stat(index); err != nil {
		writeError(w, http.StatusNotFound, "not_found", "API route not found (frontend build not present)")
		return
	}
	clean := filepath.Clean(r.URL.Path)
	candidate := filepath.Join(s.cfg.StaticDir, filepath.FromSlash(clean))
	if clean != "/" {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			// A build fingerprints everything it emits under /assets, so those
			// files can be cached hard: a new build never reuses a name.
			if strings.HasPrefix(clean, string(filepath.Separator)+"assets"+string(filepath.Separator)) {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			http.ServeFile(w, r, candidate)
			return
		}
	}
	// index.html must always be revalidated: it names the hashed bundle, and a
	// cached copy pins the browser to an old build, which makes a deploy look as
	// though it changed nothing.
	// no-store, not merely no-cache: a browser that keeps a revalidated copy of a page can
	// still pin an old bundle, which made a deploy look as though it changed nothing
	// several times while this was being built.
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	http.ServeFile(w, r, index)
}

// ---- health ----

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"version": Version,
		"mode":    s.host.Mode(),
		"time":    time.Now().UTC().Format(time.RFC3339),
	})
}
