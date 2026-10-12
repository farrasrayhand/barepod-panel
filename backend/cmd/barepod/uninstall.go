package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/config"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// `barepod uninstall` takes the panel off this host.
//
// It is guided by default: it reads what is actually here — websites, tenants and the accounts that own
// them from the store, the running containers from docker, the lockout's table from nftables — prints it,
// and asks before each step that cannot be undone. With --yes it becomes non-interactive, and then nothing
// irreversible happens unless a flag names it. Either way the backup is written and read back before a
// single file is removed: a backup that failed and a delete that followed is the worst possible order.
//
// What it does not do, because the shell script in scripts/ is the right place for it: package removal,
// and anything on a host whose binary is already gone.
func runUninstall(args []string) error {
	fs := flag.NewFlagSet("barepod uninstall", flag.ContinueOnError)
	dbPath := fs.String("db", config.DefaultDBPath(), "path to the panel database")
	unitsDir := fs.String("units-dir", "/etc/systemd/system", "systemd units directory (as serve uses)")
	confDir := fs.String("conf-dir", "/etc/barepod", "directory holding the panel's host secrets")
	backupDir := fs.String("backup-dir", "/var/backups/barepod", "where the backup goes (never inside something this removes)")
	backup := fs.String("backup", "db", "what to save first: db, full, or none")
	yes := fs.Bool("yes", false, "non-interactive; only what the flags name is done")
	backupOnly := fs.Bool("backup-only", false, "take the backup and stop: nothing is stopped or deleted")
	purgeData := fs.Bool("purge-data", false, "also delete the data directory (database, bundle, certificate)")
	removeTenants := fs.Bool("remove-tenants", false, "also delete the tenant accounts the panel created")
	removeTenantData := fs.Bool("remove-tenant-data", false, "with --remove-tenants, delete their home directories too")
	removeVolumes := fs.Bool("remove-volumes", false, "delete the container volumes too (they hold database data)")
	keepEngineConfig := fs.Bool("keep-engine-config", false, "leave the engine configuration the panel changed")
	named := map[string]bool{}
	if err := fs.Parse(args); err != nil {
		return err
	}
	fs.Visit(func(f *flag.Flag) { named[f.Name] = true })
	switch *backup {
	case "db", "full", "none":
	default:
		return fmt.Errorf("--backup must be db, full or none (got %q)", *backup)
	}

	ctx := context.Background()
	dataDir := filepath.Dir(*dbPath)
	plan := uninstallPlan{
		dbPath: *dbPath, dataDir: dataDir, confDir: *confDir, unitsDir: *unitsDir, backupDir: *backupDir,
		backup: *backup, purgeData: *purgeData, removeTenants: *removeTenants,
		removeTenantData: *removeTenantData, removeVolumes: *removeVolumes,
		keepEngineConfig: *keepEngineConfig, interactive: !*yes, backupOnly: *backupOnly,
	}

	// A backup written inside a directory this command deletes is not a backup. Refusing beats quietly
	// relocating: the reason the operator chose a path may be the reason that path matters.
	if plan.backup != "none" {
		for _, doomed := range []string{dataDir, *confDir, *unitsDir} {
			if pathInside(plan.backupDir, doomed) {
				return fmt.Errorf("--backup-dir %s is inside %s, which this uninstall deletes — choose a path outside it (the default /var/backups/barepod is on the root filesystem), or pass --backup=none", plan.backupDir, doomed)
			}
		}
	}

	if st, err := store.Open(*dbPath); err == nil {
		if sites, err := st.ListWebsites(); err == nil {
			plan.sites = sites
		}
		if dbs, err := st.AllDatabases(); err == nil {
			plan.databases = len(dbs)
		}
		_ = st.Close()
	}
	seen := map[string]bool{}
	for _, site := range plan.sites {
		if site.TenantUser != "" && !seen[site.TenantUser] {
			seen[site.TenantUser] = true
			plan.tenants = append(plan.tenants, site.TenantUser)
		}
	}
	sort.Strings(plan.tenants)
	plan.hasNFTable = commandOK(ctx, "nft", "list", "table", "inet", "barepod")
	plan.containers = panelContainers(ctx)

	printUninstallPlan(plan)

	// --backup-only stops here: the backup path is the one part of this command that destroys nothing, and
	// being able to run it on a live panel is what turns "the backup should work" into a measured fact.
	if plan.backupOnly {
		if plan.backup == "none" {
			return fmt.Errorf("--backup-only needs a backup level: db or full")
		}
		archive, err := writeUninstallBackup(ctx, plan, dataDir, !panelStopped(ctx))
		if err != nil {
			return fmt.Errorf("the backup failed: %w", err)
		}
		fmt.Printf("\nBackup written and read back: %s\n", archive)
		if !panelStopped(ctx) {
			fmt.Printf("Nothing was stopped or removed. The panel is still running on its port.\n")
		}
		return nil
	}

	if plan.interactive {
		if !stdinIsTerminal() {
			// No terminal to ask in: print the plan and change nothing. Same behaviour as the shell script,
			// and what makes a dry run over ssh possible.
			fmt.Printf("\nDry run: nothing was changed (no terminal to ask in). Re-run with --yes, and name what\nyou want removed: --purge-data, --remove-tenants, --remove-tenant-data, --remove-volumes.\n")
			return nil
		}
		// Choices first, then the plan they produce, and only then the one answer that is final. Asking for
		// a typed "uninstall" before showing what could be chosen read as a demand, not a choice — the
		// operator said so after running it.
		if !named["backup"] {
			answer, _ := ask("Back it up first?\n    1) the panel database and the certificate (default)\n    2) those plus /etc/barepod and the systemd unit files\n    3) nothing at all\n  Choose [1]")
			switch strings.TrimSpace(answer) {
			case "2":
				plan.backup = "full"
			case "3":
				plan.backup = "none"
			default:
				plan.backup = "db"
			}
		}
		if !named["purge-data"] {
			if answer, _ := ask("Delete the data directory %s as well (records, accounts, audit log, certificate)? [y/N]", dataDir); isYes(answer) {
				plan.purgeData = true
			}
		}
		if len(plan.tenants) > 0 {
			if !named["remove-tenants"] {
				if answer, _ := ask("Delete the tenant accounts %s? [y/N]", strings.Join(plan.tenants, ", ")); isYes(answer) {
					plan.removeTenants = true
				}
			}
			if plan.removeTenants && !named["remove-tenant-data"] {
				if answer, _ := ask("Delete their files under %s too? [y/N]", config.DefaultSitesRoot()); isYes(answer) {
					plan.removeTenantData = true
				}
			}
		}
		if !named["remove-volumes"] {
			if answer, _ := ask("Delete the container volumes as well (they hold containerised database data)? [y/N]"); isYes(answer) {
				plan.removeVolumes = true
			}
		}

		fmt.Printf("\nThat is the plan:\n")
		printUninstallPlan(plan)
		answer, err := ask("Type uninstall to go ahead")
		if err != nil {
			return err
		}
		if strings.TrimSpace(answer) != "uninstall" {
			return fmt.Errorf("nothing was changed")
		}
	}

	removed := []string{}
	// 1. stop the panel and the sites, and release anyone the lockout banned
	for _, site := range plan.sites {
		_ = run(ctx, "systemctl", "disable", "--now", "barepod-app@"+site.Slug+".service")
	}
	_ = run(ctx, "systemctl", "disable", "--now", "barepod.service")
	_ = run(ctx, "systemctl", "reset-failed", "barepod.service")
	removed = append(removed, "services stopped")
	if plan.hasNFTable {
		if err := run(ctx, "nft", "delete", "table", "inet", "barepod"); err == nil {
			removed = append(removed, "lockout table deleted (every address it banned is released)")
		}
	}

	// 2. the backup, with the panel already stopped — it writes SQLite in WAL mode, and a copy taken from a
	//    running panel can miss the commits still in the write-ahead log
	if plan.backup != "none" {
		archive, err := writeUninstallBackup(ctx, plan, dataDir, false)
		if err != nil {
			return fmt.Errorf("nothing was removed: the backup failed (%w)", err)
		}
		removed = append(removed, "backup written and read back: "+archive)
		fmt.Printf("  backup: %s\n", archive)
	}

	// 3. the panel's own units and files
	for _, site := range plan.sites {
		_ = os.Remove(filepath.Join(plan.unitsDir, "barepod-app@"+site.Slug+".service"))
		_ = os.RemoveAll(filepath.Join(plan.unitsDir, "barepod-app@"+site.Slug+".service.d"))
	}
	_ = os.Remove(filepath.Join(plan.unitsDir, "barepod.service"))
	_ = os.Remove(filepath.Join(plan.unitsDir, "barepod.service.barepod-backup"))
	_ = os.RemoveAll(filepath.Join(plan.unitsDir, "barepod.service.d"))
	_ = os.Remove(filepath.Join(plan.unitsDir, "barepod-app@.service"))
	_ = run(ctx, "systemctl", "daemon-reload")
	if self, err := os.Executable(); err == nil {
		_ = os.Remove(self)
	}
	_ = os.Remove("/usr/local/bin/pgweb")
	_ = os.RemoveAll(plan.confDir)
	_ = os.RemoveAll(config.DefaultDbtoolsDir())
	removed = append(removed, "unit files, the binary, "+plan.confDir+" and the tool logs")

	// 4. give the engines back the way the installer found them
	if !plan.keepEngineConfig {
		restored := restoreEngineConfig(ctx)
		removed = append(removed, "engine configuration restored: "+strings.Join(restored, ", "))
	}

	// 5. the containers the panel ran (their volumes only when asked: they hold data)
	for _, name := range plan.containers {
		_ = run(ctx, "docker", "rm", "-f", name)
	}
	if len(plan.containers) > 0 {
		removed = append(removed, fmt.Sprintf("%d panel container(s) removed", len(plan.containers)))
	}
	if plan.removeVolumes {
		for _, volume := range panelVolumes(ctx) {
			_ = run(ctx, "docker", "volume", "rm", volume)
		}
		removed = append(removed, "container volumes deleted")
	}

	// 6. tenant accounts, and their files only when asked twice
	if plan.removeTenants {
		for _, tenant := range plan.tenants {
			if tenant == "root" {
				continue
			}
			if plan.removeTenantData {
				_ = run(ctx, "userdel", "-r", tenant)
			} else {
				_ = run(ctx, "userdel", tenant)
			}
		}
		removed = append(removed, fmt.Sprintf("%d tenant account(s) removed", len(plan.tenants)))
	}

	// 7. the data directory, only with consent
	if plan.purgeData {
		_ = os.RemoveAll(dataDir)
		removed = append(removed, "data directory deleted: "+dataDir)
	}

	fmt.Printf("\nRemoved:\n")
	for _, line := range removed {
		fmt.Printf("  - %s\n", line)
	}
	fmt.Printf("\nLeft alone on purpose:\n")
	if !plan.purgeData {
		fmt.Printf("  - %s (delete it yourself, or re-run with --purge-data)\n", dataDir)
	}
	if !plan.removeTenants && len(plan.tenants) > 0 {
		fmt.Printf("  - tenant accounts and their files (%s)\n", strings.Join(plan.tenants, ", "))
	}
	fmt.Printf("  - the engines and their packages (scripts/uninstall.sh --remove-packages does that)\n")
	fmt.Printf("  - journald history (journalctl --vacuum-time=1s clears it)\n")
	if plan.backup != "none" {
		fmt.Printf("\nThe backup survives this run. If the host itself is being rebuilt, copy it somewhere else\n"+
			"first: %s\n", plan.backupDir)
	}
	return nil
}

type uninstallPlan struct {
	dbPath, dataDir, confDir, unitsDir, backupDir string
	backup                                        string
	purgeData, removeTenants, removeTenantData    bool
	removeVolumes, keepEngineConfig, interactive  bool
	backupOnly                                    bool
	hasNFTable                                    bool
	sites                                         []store.Website
	tenants                                       []string
	containers                                    []string
	databases                                     int
}

func printUninstallPlan(plan uninstallPlan) {
	fmt.Printf("BarePod uninstall — plan\n")
	fmt.Printf("  sites:            %d (%s)\n", len(plan.sites), slugs(plan.sites))
	fmt.Printf("  tenant accounts:  %d (%s)\n", len(plan.tenants), joinOr(plan.tenants, "none"))
	fmt.Printf("  databases on the ledger: %d\n", plan.databases)
	fmt.Printf("  binary:           %s\n", selfPath())
	fmt.Printf("  data:             %s%s\n", plan.dataDir, onOff(plan.purgeData, "  -> will be DELETED", "  -> kept"))
	fmt.Printf("  backup:           %s%s\n", plan.backup, backupWhere(plan))
	fmt.Printf("  config:           %s\n", plan.confDir)
	fmt.Printf("  lockout:          table inet barepod%s\n", onOff(plan.hasNFTable, " (present)", " (absent)"))
	fmt.Printf("  containers:       %d (%s)%s\n", len(plan.containers), joinOr(plan.containers, "none"), onOff(plan.removeVolumes, "  -> with volumes", "  -> volumes kept"))
	fmt.Printf("  tenant files:     %s%s\n", config.DefaultSitesRoot(), onOff(plan.removeTenantData, "  -> DELETED", "  -> kept"))
}

func backupWhere(plan uninstallPlan) string {
	if plan.backup == "none" {
		return "  (nothing is saved anywhere)"
	}
	return "  -> " + plan.backupDir + "/barepod-backup-<host>-<date>.tar.gz"
}

// writeUninstallBackup saves what the plan asked for and proves it can be read back. The caller stops
// everything first, so the database copy is taken from a panel that is not writing; sqlite3's own copy is
// preferred when it exists because it is consistent even under a writer.
func writeUninstallBackup(ctx context.Context, plan uninstallPlan, dataDir string, live bool) (string, error) {
	if err := os.MkdirAll(plan.backupDir, 0o700); err != nil {
		return "", err
	}
	host, _ := os.Hostname()
	stamp := time.Now().Format("20060102-150405")
	archive := filepath.Join(plan.backupDir, fmt.Sprintf("barepod-backup-%s-%s.tar.gz", shortHost(host), stamp))
	work, err := os.MkdirTemp("", "barepod-uninstall-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(work)
	dir := filepath.Join(work, "barepod")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}

	if _, err := os.Stat(plan.dbPath); err == nil {
		copied := false
		if _, err := exec.LookPath("sqlite3"); err == nil {
			if err := run(ctx, "sqlite3", plan.dbPath, "VACUUM INTO '"+filepath.Join(dir, "barepod.db")+"'"); err == nil {
				copied = true
			}
		}
		if !copied {
			// Without sqlite3 there is no consistent copy available, and a plain cp of a database a running
			// panel is writing to can miss the commits still in its write-ahead log. Say so rather than
			// hand back a file that looks whole.
			if live {
				fmt.Printf("  note: sqlite3 is not installed here and the panel is running, so this copy may be\n" +
					"  missing recent writes (the -wal sidecar is included, which is the best that can be done)\n")
			}
			if err := copyFile(plan.dbPath, filepath.Join(dir, "barepod.db")); err != nil {
				return "", err
			}
			for _, sidecar := range []string{"-wal", "-shm"} {
				if _, err := os.Stat(plan.dbPath + sidecar); err == nil {
					_ = copyFile(plan.dbPath+sidecar, filepath.Join(dir, "barepod.db"+sidecar))
				}
			}
		}
	}
	for _, cert := range []string{"panel-selfsigned.crt", "panel-selfsigned.key"} {
		source := filepath.Join(dataDir, cert)
		if _, err := os.Stat(source); err == nil {
			_ = copyFile(source, filepath.Join(dir, cert))
		}
	}
	if plan.backup == "full" {
		_ = copyTree(plan.confDir, filepath.Join(work, "etc", "barepod"))
		for _, name := range []string{"barepod.service", "barepod-app@.service"} {
			_ = copyFile(filepath.Join(plan.unitsDir, name), filepath.Join(work, "units", name))
		}
		_ = copyTree(filepath.Join(plan.unitsDir, "barepod.service.d"), filepath.Join(work, "units", "barepod.service.d"))
		for _, site := range plan.sites {
			name := "barepod-app@" + site.Slug + ".service"
			_ = copyFile(filepath.Join(plan.unitsDir, name), filepath.Join(work, "units", name))
			_ = copyTree(filepath.Join(plan.unitsDir, name+".d"), filepath.Join(work, "units", name+".d"))
		}
	}
	manifest := strings.Join([]string{
		"barepod-backup 1",
		"host: " + host,
		"date: " + time.Now().Format(time.RFC3339),
		"level: " + plan.backup,
		"sites: " + slugs(plan.sites),
		"tenants: " + joinOr(plan.tenants, "none"),
		"",
		"Contains: the panel database (accounts, records, their settings and the audit log), and the",
		"self-signed certificate" + fullNote(plan.backup) + ".",
		"Does not contain: the contents of your databases or your site files. Their credentials are encrypted",
		"inside the panel database this backup holds, so a dump cannot be authenticated for from here — use",
		"the panel's Export for each database, and copy site files, before uninstalling.",
		"",
	}, "\n")
	if err := os.WriteFile(filepath.Join(dir, "MANIFEST.txt"), []byte(manifest), 0o600); err != nil {
		return "", err
	}
	if err := run(ctx, "tar", "-czf", archive, "-C", work, "barepod"); err != nil {
		return "", err
	}
	// Read it back before anything is deleted: a failed backup followed by a delete is the worst order.
	if info, err := os.Stat(archive); err != nil || info.Size() == 0 {
		return "", fmt.Errorf("the archive is missing or empty")
	}
	if err := run(ctx, "tar", "-tzf", archive); err != nil {
		return "", fmt.Errorf("the archive cannot be read back (%w)", err)
	}
	return archive, nil
}

func fullNote(level string) string {
	if level == "full" {
		return ", /etc/barepod and the systemd unit files"
	}
	return ""
}

// restoreEngineConfig gives the engines back the settings the panel changed. Redis matters most: its
// aclfile directive points at a file we delete, and leaving it would stop redis from starting at all.
func restoreEngineConfig(ctx context.Context) []string {
	done := []string{}
	if pathExists("/etc/redis/redis.conf") {
		_ = rewriteConfigFile("/etc/redis/redis.conf", func(line string) (string, bool) {
			trimmed := strings.TrimSpace(line)
			switch {
			case strings.HasPrefix(trimmed, "aclfile"):
				return "# aclfile (removed by the BarePod uninstall)", true
			case strings.HasPrefix(trimmed, "bind"):
				return "bind 127.0.0.1 -::1", true
			}
			return line, false
		})
		_ = os.Remove("/etc/redis/users.acl")
		_ = run(ctx, "systemctl", "reload-or-restart", "redis-server")
		done = append(done, "redis")
	}
	for _, pattern := range []string{"/etc/postgresql/*/main"} {
		dirs, _ := filepath.Glob(pattern)
		for _, pg := range dirs {
			_ = os.Remove(filepath.Join(pg, "conf.d", "99-barepod.conf"))
			if backup := filepath.Join(pg, "pg_hba.conf.barepod-backup"); pathExists(backup) {
				_ = copyFile(backup, filepath.Join(pg, "pg_hba.conf"))
			}
			done = append(done, "postgresql")
		}
	}
	_ = os.Remove("/etc/mysql/mariadb.conf.d/99-barepod.cnf")
	if pathExists("/etc/mysql/mariadb.conf.d/50-server.cnf") {
		_ = rewriteConfigFile("/etc/mysql/mariadb.conf.d/50-server.cnf", func(line string) (string, bool) {
			if strings.HasPrefix(strings.TrimSpace(line), "bind-address") {
				return "bind-address            = 127.0.0.1", true
			}
			return line, false
		})
		_ = run(ctx, "systemctl", "reload-or-restart", "mariadb")
		done = append(done, "mariadb")
	}
	return done
}

// rewriteConfigFile rewrites the lines the callback claims, and says nothing about the rest. It is the one
// place the two config edits share, so the rule lives in one readable function.
func rewriteConfigFile(path string, edit func(string) (string, bool)) error {
	body, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	_ = copyFile(path, path+".barepod-uninstall.bak")
	lines := strings.Split(strings.TrimRight(string(body), "\n"), "\n")
	changed := false
	for i, line := range lines {
		replacement, claim := edit(line)
		if claim && replacement != line {
			lines[i] = replacement
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o644)
}

// pathInside says whether child resolves to something under parent, which is what decides if a backup
// directory would be deleted by the very run that made it.
func pathInside(child, parent string) bool {
	child, parent = resolvePath(child), resolvePath(parent)
	return child == parent || strings.HasPrefix(child, parent+string(os.PathSeparator))
}

// resolvePath resolves the deepest part of a path that exists and re-attaches what does not.
//
// The backup directory does not exist yet when this check runs, and comparing a resolved parent with an
// unresolved child is how the check misses the very case it exists for: on a host where an ancestor is a
// symlink — macOS /var, or a data directory mounted somewhere else — "inside" then reads as "outside".
// Found by the test that this function was written from; the first version returned false for a child one
// level below the directory it was supposed to be inside.
func resolvePath(path string) string {
	path = filepath.Clean(path)
	missing := []string{}
	for {
		if real, err := filepath.EvalSymlinks(path); err == nil {
			return filepath.Join(append([]string{real}, missing...)...)
		}
		parent := filepath.Dir(path)
		if parent == path {
			return filepath.Join(append([]string{path}, missing...)...)
		}
		missing = append([]string{filepath.Base(path)}, missing...)
		path = parent
	}
}

func panelContainers(ctx context.Context) []string {
	out, err := output(ctx, "docker", "ps", "-a", "--format", "{{.Names}}")
	if err != nil {
		return nil
	}
	names := []string{}
	for _, name := range strings.Split(strings.TrimSpace(out), "\n") {
		name = strings.TrimSpace(name)
		if strings.HasPrefix(name, "barepod-mongo") || strings.HasPrefix(name, "barepod-dbgate") {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names
}

func panelVolumes(ctx context.Context) []string {
	out, err := output(ctx, "docker", "volume", "ls", "--format", "{{.Name}}")
	if err != nil {
		return nil
	}
	names := []string{}
	for _, name := range strings.Split(strings.TrimSpace(out), "\n") {
		if strings.HasPrefix(strings.TrimSpace(name), "barepod") {
			names = append(names, strings.TrimSpace(name))
		}
	}
	return names
}

func ask(format string, args ...any) (string, error) {
	fmt.Printf("\n  "+format+": ", args...)
	reader := bufio.NewReader(os.Stdin)
	answer, err := reader.ReadString('\n')
	return answer, err
}

func isYes(answer string) bool {
	switch strings.ToLower(strings.TrimSpace(answer)) {
	case "y", "yes", "ya", "iya":
		return true
	}
	return false
}

func stdinIsTerminal() bool {
	info, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return info.Mode()&os.ModeCharDevice != 0
}

func commandOK(ctx context.Context, name string, args ...string) bool {
	_, err := output(ctx, name, args...)
	return err == nil
}

func output(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.Output()
	return string(out), err
}

func run(ctx context.Context, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	return cmd.Run()
}

func copyFile(source, destination string) error {
	body, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return err
	}
	return os.WriteFile(destination, body, 0o600)
}

func copyTree(source, destination string) error {
	return filepath.Walk(source, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return nil
		}
		target := filepath.Join(destination, relative)
		if info.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		return copyFile(path, target)
	})
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func selfPath() string {
	if self, err := os.Executable(); err == nil {
		return self
	}
	return "barepod"
}

func shortHost(host string) string {
	if host == "" {
		return "host"
	}
	if index := strings.Index(host, "."); index > 0 {
		return host[:index]
	}
	return host
}

func slugs(sites []store.Website) string {
	names := make([]string, 0, len(sites))
	for _, site := range sites {
		names = append(names, site.Slug)
	}
	return joinOr(names, "none")
}

func joinOr(items []string, empty string) string {
	if len(items) == 0 {
		return empty
	}
	return strings.Join(items, ", ")
}

func onOff(when bool, yes, no string) string {
	if when {
		return yes
	}
	return no
}

// panelStopped says whether the panel service is running, which is what decides if a plain database copy
// is safe to describe as consistent.
func panelStopped(ctx context.Context) bool {
	out, err := output(ctx, "systemctl", "is-active", "barepod.service")
	if err != nil {
		return true
	}
	return strings.TrimSpace(out) != "active"
}
