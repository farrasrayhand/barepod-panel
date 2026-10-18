package scheduler

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/enginedb"
	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/notify"
	"github.com/farrasrayhand/barepod-panel/backend/internal/stack"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/sysinfo"
)

// Env is what a job reads and acts through.
type Env struct {
	Store         *store.Store
	Host          *host.Host
	Key           []byte
	Caps          sysinfo.Capabilities
	Notify        *notify.Dispatcher
	DiskThreshold int
	Logf          func(string, ...any)
}

// Job is one built-in maintenance task the panel lists and the daemon runs.
type Job struct {
	ID              string
	Label           string
	Desc            string
	Category        string
	DefaultSchedule string
	// DefaultEnabled is true only for jobs that are read-only or self-healing. Anything that frees
	// or changes disk state starts disabled, so a fresh install (or an in-panel update that adds
	// this scheduler) never begins deleting on its own before an operator has seen it.
	DefaultEnabled bool
	// Implemented is false for a job the panel lists but the daemon cannot run yet; the UI shows it
	// as "Not implemented" rather than pretending.
	Implemented bool
	// Timeout overrides the scheduler's default. Zero means the default; a package upgrade or a
	// database vacuum is given room so it cannot be killed halfway through.
	Timeout time.Duration
	Run     func(ctx context.Context, env *Env) (string, error)
}

// TimeoutFor is the wall-clock budget a job is given.
func TimeoutFor(job Job) time.Duration {
	if job.Timeout > 0 {
		return job.Timeout
	}
	return jobTimeout
}

var registry = []Job{
	{
		ID: "service_watchdog", Label: "Service watchdog", Category: "watchdog",
		Desc: "Restart nginx/caddy/php-fpm/docker/cloudflared and the database engines if they are down.",
		DefaultSchedule: "*/5 * * * *", DefaultEnabled: true, Implemented: true,
		Run: func(ctx context.Context, env *Env) (string, error) {
			actions := stack.AutoHeal(ctx, env.Host.Runner)
			if len(actions) == 0 {
				return "all monitored services healthy; nothing to repair", nil
			}
			return fmt.Sprintf("repaired %d item(s):\n%s", len(actions), strings.Join(actions, "\n")), nil
		},
	},
	{
		ID: "metrics_prune", Label: "Metrics & log retention prune", Category: "maintenance",
		Desc: "Trim retained deploy/job records and vacuum the system journal past retention.",
		DefaultSchedule: "0 3 * * *", DefaultEnabled: true, Implemented: true,
		Run: func(ctx context.Context, env *Env) (string, error) {
			pruned, err := pruneRetainedJobs(ctx, env)
			if err != nil {
				return "", err
			}
			vacuumJournal(ctx, env, 14)
			return fmt.Sprintf("pruned %d retained job record(s); live metrics are held in memory and need no pruning", pruned), nil
		},
	},
	{
		ID: "logrotate", Label: "Log rotation", Category: "system",
		Desc: "Rotate and compress service logs.",
		DefaultSchedule: "0 2 * * *", DefaultEnabled: true, Implemented: true,
		Run: func(ctx context.Context, env *Env) (string, error) {
			if _, err := os.Stat("/etc/logrotate.conf"); err != nil {
				return "no /etc/logrotate.conf on this host; nothing to rotate", nil
			}
			out, err := env.Host.Run(ctx, []string{"logrotate", "-f", "/etc/logrotate.conf"})
			out = strings.TrimSpace(out)
			if err != nil {
				return out, err
			}
			// logrotate prints nothing on a clean pass.
			if out == "" {
				return "forced a rotation pass over /etc/logrotate.conf; logrotate reported no errors", nil
			}
			return out, nil
		},
	},
	{
		ID: "ssl_renew", Label: "SSL certificate renewal", Category: "security",
		Desc: "Renew Let's Encrypt certificates that are due, then reload the web server.",
		DefaultSchedule: "0 0,12 * * *", DefaultEnabled: true, Implemented: true,
		Run: func(ctx context.Context, env *Env) (string, error) {
			if !hasBinary("certbot") {
				return "certbot is not installed; no certificates to renew", nil
			}
			out, err := env.Host.Run(ctx, []string{"certbot", "renew", "--quiet", "--no-random-sleep-on-renew"})
			reloadWebServers(ctx, env)
			out = strings.TrimSpace(out)
			if err != nil {
				return out, err
			}
			// certbot renew is silent when nothing was due, which otherwise reads as "the job did
			// nothing".
			if out == "" {
				return "certbot renew completed: no certificate was due for renewal (web servers reloaded)", nil
			}
			return out, nil
		},
	},
	{
		ID: "disk_alert", Label: "Disk & resource alerts", Category: "alert",
		Desc: "Notify when the root filesystem's usage crosses the alert threshold.",
		DefaultSchedule: "*/15 * * * *", DefaultEnabled: true, Implemented: true,
		Run: func(ctx context.Context, env *Env) (string, error) {
			pct, err := diskUsagePercent("/")
			if err != nil {
				return "", fmt.Errorf("could not read disk usage: %w", err)
			}
			threshold := env.DiskThreshold
			if threshold <= 0 {
				threshold = 90
			}
			if pct < float64(threshold) {
				return fmt.Sprintf("root filesystem at %.0f%% — below the %d%% threshold", pct, threshold), nil
			}
			msg := notify.Message{
				Title: fmt.Sprintf("Disk usage %.0f%% on /", pct),
				Body: fmt.Sprintf("The root filesystem is at %.0f%%, past the %d%% alert threshold. Free space or raise the threshold in Settings → Alerts.",
					pct, threshold),
				Level: "warning",
			}
			errs := env.Notify.Send(ctx, msg)
			if len(errs) > 0 {
				return "", fmt.Errorf("disk at %.0f%% but the alert could not be delivered: %v", pct, errs)
			}
			if len(env.Notify.Names()) == 0 {
				return fmt.Sprintf("disk at %.0f%% (threshold %d%%) — no notification channel is configured", pct, threshold), nil
			}
			return fmt.Sprintf("disk at %.0f%% (threshold %d%%); alerted via %s", pct, threshold, strings.Join(env.Notify.Names(), ", ")), nil
		},
	},
	{
		ID: "smart_test", Label: "S.M.A.R.T. short self-test", Category: "system",
		Desc: "Weekly disk health self-test on each physical drive.",
		DefaultSchedule: "0 1 * * 0", DefaultEnabled: true, Implemented: true,
		Run: func(ctx context.Context, env *Env) (string, error) {
			if !env.Caps.Smart {
				return "smartctl is not available on this host (or it is a container); skipping", nil
			}
			return runSmartShortTests(ctx, env)
		},
	},
	{
		ID: "fstrim", Label: "SSD TRIM (fstrim)", Category: "system",
		Desc: "Discard unused blocks to keep NVMe/SSD performance.",
		DefaultSchedule: "0 2 * * 0", DefaultEnabled: true, Implemented: true,
		Run: func(ctx context.Context, env *Env) (string, error) {
			if !env.Caps.Fstrim {
				return "fstrim is not available on this host (container without discard support); skipping", nil
			}
			out, err := env.Host.Run(ctx, []string{"fstrim", "-av"})
			return strings.TrimSpace(out), err
		},
	},
	{
		ID: "docker_prune", Label: "Docker system prune", Category: "docker",
		Desc: "Dangling images, stopped containers, and build cache.",
		DefaultSchedule: "30 4 * * *", DefaultEnabled: false, Implemented: true,
		Run: func(ctx context.Context, env *Env) (string, error) {
			if !env.Caps.Docker {
				return "docker is not installed; nothing to prune", nil
			}
			out, err := env.Host.Run(ctx, []string{"docker", "system", "prune", "-f"})
			return strings.TrimSpace(out), err
		},
	},
	{
		ID: "system_junk", Label: "System junk cleanup", Category: "maintenance",
		Desc: "Clear /tmp files and journal entries older than the retention window.",
		DefaultSchedule: "0 4 * * *", DefaultEnabled: false, Implemented: true,
		Run: func(ctx context.Context, env *Env) (string, error) {
			out, err := env.Host.Run(ctx, []string{
				"find", "/tmp", "-xdev", "-mindepth", "1", "-maxdepth", "1", "-mtime", "+7",
				"-exec", "rm", "-rf", "{}", "+",
			})
			if err != nil {
				return strings.TrimSpace(out), err
			}
			vacuumJournal(ctx, env, 7)
			return "cleared /tmp entries older than 7 days and vacuumed the journal", nil
		},
	},
	{
		ID: "security_updates", Label: "Security OS updates", Category: "security",
		Desc: "Install pending security upgrades (apt unattended-upgrades).",
		DefaultSchedule: "0 5 * * *", DefaultEnabled: false, Implemented: true,
		// A package upgrade is not a five-minute job: give it room so a slow mirror or a local
		// rebuild cannot be killed halfway and leave dpkg wanting repair.
		Timeout: 60 * time.Minute,
		Run: func(ctx context.Context, env *Env) (string, error) {
			if !hasBinary("apt-get") {
				return "apt-get is not available on this host; nothing to update", nil
			}
			// unattended-upgrade is the security-only path when the host has it configured.
			if hasBinary("unattended-upgrade") {
				out, err := env.Host.Run(ctx, []string{"unattended-upgrade", "-v"})
				return strings.TrimSpace(out), err
			}
			out, err := env.Host.Run(ctx, []string{
				"apt-get", "-y",
				"-o", "DPkg::Lock::Timeout=600",
				"-o", "Dpkg::Options::=--force-confold",
				"-o", "Dpkg::Options::=--force-confdef",
				"upgrade",
			})
			return strings.TrimSpace(out), err
		},
	},
	{
		ID: "db_maintenance", Label: "Database maintenance", Category: "database",
		Desc: "PostgreSQL VACUUM ANALYZE & MariaDB/MySQL table optimize on every managed database.",
		DefaultSchedule: "0 3 * * 0", DefaultEnabled: false, Implemented: true,
		Timeout: 30 * time.Minute,
		Run:     runDatabaseMaintenance,
	},
}

// Registry returns the built-in jobs, in the order the panel shows them.
func Registry() []Job { return append([]Job(nil), registry...) }

// Lookup finds a job by id.
func Lookup(id string) (Job, bool) {
	for _, j := range registry {
		if j.ID == id {
			return j, true
		}
	}
	return Job{}, false
}

// Defaults are the seed rows for system_cron_jobs.
func Defaults() []store.SystemCronJob {
	out := make([]store.SystemCronJob, 0, len(registry))
	for _, j := range registry {
		out = append(out, store.SystemCronJob{ID: j.ID, Enabled: j.DefaultEnabled, Schedule: j.DefaultSchedule})
	}
	return out
}

// RunJob runs one job by id. It reloads the notification configuration first so an alert uses the
// channels as they are now, not as they were when the daemon started.
func RunJob(ctx context.Context, env *Env, id string) (string, error) {
	job, ok := Lookup(id)
	if !ok {
		return "", fmt.Errorf("unknown maintenance job %q", id)
	}
	if !job.Implemented || job.Run == nil {
		return "", fmt.Errorf("%s is not implemented by this daemon yet", job.Label)
	}
	if env.Key != nil {
		if cfg, err := notify.LoadConfig(env.Store, env.Key); err == nil {
			env.Notify = notify.Build(cfg)
			env.DiskThreshold = cfg.Threshold()
		}
	}
	return job.Run(ctx, env)
}

// --- helpers shared by the jobs -------------------------------------------------------------

func pruneRetainedJobs(ctx context.Context, env *Env) (int, error) {
	sites, err := env.Store.ListWebsites()
	if err != nil {
		return 0, err
	}
	total := 0
	for _, site := range sites {
		if n, err := env.Store.PruneDeployJobs(site.Slug, 10); err == nil {
			total += n
		}
	}
	if n, err := env.Store.PruneDeployJobs(stack.JobSlug, 5); err == nil {
		total += n
	}
	_ = ctx
	return total, nil
}

func vacuumJournal(ctx context.Context, env *Env, days int) {
	if !env.Caps.Systemd {
		return
	}
	_, _ = env.Host.Run(ctx, []string{"journalctl", "--vacuum-time=" + strconv.Itoa(days) + "d"})
}

func reloadWebServers(ctx context.Context, env *Env) {
	for _, unit := range []string{"nginx", "caddy"} {
		if out, _ := env.Host.Run(ctx, []string{"systemctl", "is-active", unit}); strings.TrimSpace(out) == "active" {
			_, _ = env.Host.Run(ctx, []string{"systemctl", "reload", unit})
		}
	}
}

func runSmartShortTests(ctx context.Context, env *Env) (string, error) {
	out, err := env.Host.Run(ctx, []string{"lsblk", "-ndo", "NAME,TYPE"})
	if err != nil {
		return strings.TrimSpace(out), err
	}
	var disks []string
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[1] == "disk" {
			disks = append(disks, "/dev/"+fields[0])
		}
	}
	if len(disks) == 0 {
		return "no physical disks reported by lsblk; nothing to test", nil
	}
	var report strings.Builder
	for _, dev := range disks {
		res, err := env.Host.Run(ctx, []string{"smartctl", "-t", "short", dev})
		line := strings.TrimSpace(res)
		if err != nil {
			line = fmt.Sprintf("%s: %v", strings.TrimSpace(res), err)
		}
		fmt.Fprintf(&report, "%s: %s\n", dev, line)
	}
	return strings.TrimSpace(report.String()), nil
}

// runDatabaseMaintenance vacuums/optimizes every database the panel manages. It connects with the
// panel's pure-Go drivers as the database's own user, so the host needs no psql/mysql client.
func runDatabaseMaintenance(ctx context.Context, env *Env) (string, error) {
	records, err := env.Store.DatabasesForTenant(store.KindDatabase, "", false)
	if err != nil {
		return "", err
	}

	var report strings.Builder
	handled, failures := 0, 0
	for i := range records {
		record := &records[i]
		if record.Status != "ready" {
			continue
		}
		switch record.Engine {
		case "postgresql", "mysql", "mariadb":
		default:
			continue
		}
		handled++
		result, err := maintainDatabase(ctx, env, record)
		if err != nil {
			failures++
			fmt.Fprintf(&report, "%s (%s): failed — %v\n", record.Alias, record.Engine, err)
			continue
		}
		fmt.Fprintf(&report, "%s (%s): %s\n", record.Alias, record.Engine, result)
	}

	if handled == 0 {
		return "no PostgreSQL/MySQL/MariaDB databases to maintain", nil
	}
	out := strings.TrimSpace(report.String())
	if failures > 0 {
		return out, fmt.Errorf("%d of %d database(s) failed maintenance", failures, handled)
	}
	return out, nil
}

func maintainDatabase(ctx context.Context, env *Env, record *store.Database) (string, error) {
	db, err := enginedb.Open(record, env.Key)
	if err != nil {
		return "", err
	}
	defer func() { _ = db.Close() }()

	if err := db.PingContext(ctx); err != nil {
		return "", err
	}

	switch record.Engine {
	case "postgresql":
		// VACUUM cannot run inside a transaction; ExecContext here is autocommit, which is what it
		// needs.
		if _, err := db.ExecContext(ctx, "VACUUM ANALYZE"); err != nil {
			return "", err
		}
		return "VACUUM ANALYZE done", nil
	case "mysql", "mariadb":
		tables, err := mysqlBaseTables(ctx, db)
		if err != nil {
			return "", err
		}
		if len(tables) == 0 {
			return "no tables to optimize", nil
		}
		optimized, firstErr := 0, error(nil)
		for _, table := range tables {
			if _, err := db.ExecContext(ctx, "OPTIMIZE TABLE "+quoteMySQLIdent(table)); err != nil {
				if firstErr == nil {
					firstErr = fmt.Errorf("%s: %w", table, err)
				}
				continue
			}
			optimized++
		}
		if firstErr != nil {
			return fmt.Sprintf("optimized %d of %d table(s)", optimized, len(tables)), firstErr
		}
		return fmt.Sprintf("optimized %d table(s)", optimized), nil
	}
	return "nothing to do for this engine", nil
}

func mysqlBaseTables(ctx context.Context, db *sql.DB) ([]string, error) {
	rows, err := db.QueryContext(ctx, `SELECT table_name FROM information_schema.tables
		WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}

func quoteMySQLIdent(name string) string {
	return "`" + strings.ReplaceAll(name, "`", "``") + "`"
}

func diskUsagePercent(path string) (float64, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, err
	}
	blockSize := uint64(st.Bsize)
	total := st.Blocks * blockSize
	free := st.Bavail * blockSize
	if total == 0 {
		return 0, fmt.Errorf("filesystem reports no blocks")
	}
	return float64(total-free) / float64(total) * 100, nil
}

func hasBinary(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}
