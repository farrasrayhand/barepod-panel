package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"runtime"
	"strconv"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/config"
	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/rbac"
	"github.com/farrasrayhand/barepod-panel/backend/internal/resources"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/sysinfo"
	"github.com/farrasrayhand/barepod-panel/backend/internal/tenant"
)

// newTenantManager builds the OS-account manager. Privileged work only happens
// for real on Linux; everywhere else the runner records the commands instead.
func newTenantManager(dryRun bool) *tenant.Manager {
	caps := sysinfo.Detect()
	runner := host.Runner(host.RealRunner{})
	if dryRun || runtime.GOOS != "linux" {
		runner = &host.DryRunner{}
	}
	return tenant.New(runner, config.DefaultSitesRoot(), caps)
}

// parseQuota accepts "10GB", "512MB", "2TB" or a plain byte count.
func parseQuota(raw string) (int64, error) {
	s := strings.ToUpper(strings.TrimSpace(raw))
	if s == "" {
		return 0, nil
	}
	multiplier := int64(1)
	switch {
	case strings.HasSuffix(s, "TB"):
		multiplier, s = 1024*1024*1024*1024, strings.TrimSuffix(s, "TB")
	case strings.HasSuffix(s, "GB"):
		multiplier, s = 1024*1024*1024, strings.TrimSuffix(s, "GB")
	case strings.HasSuffix(s, "MB"):
		multiplier, s = 1024*1024, strings.TrimSuffix(s, "MB")
	case strings.HasSuffix(s, "KB"):
		multiplier, s = 1024, strings.TrimSuffix(s, "KB")
	case strings.HasSuffix(s, "B"):
		s = strings.TrimSuffix(s, "B")
	}
	value, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	if err != nil || value < 0 {
		return 0, fmt.Errorf("%q is not a valid size — try 10GB, 512MB or a byte count", raw)
	}
	return value * multiplier, nil
}

// provisionOSUser creates the Linux account (and its quota) for a panel account.
func provisionOSUser(_ *store.Store, username string, group *rbac.Group, quotaOverride string, dryRun bool) error {
	quotaBytes := group.Limits.DiskQuotaBytes()
	if quotaOverride != "" {
		parsed, err := parseQuota(quotaOverride)
		if err != nil {
			return err
		}
		quotaBytes = parsed
	}

	mgr := newTenantManager(dryRun)
	fmt.Println("Linux tenant account")
	res, err := mgr.Provision(context.Background(), username, tenant.Options{
		Shell:       "/bin/bash", // the panel offers a web terminal; SSH access is not granted
		QuotaBytes:  quotaBytes,
		QuotaInodes: int64(group.Limits.InodeQuota),
		Filesystem:  "/",
	}, func(line string) { fmt.Println("  " + line) })

	if res != nil {
		fmt.Printf("  home      %s\n", res.Home)
		if !res.Created {
			fmt.Println("  state     not created (dry-run, or the account already existed)")
		}
		for _, note := range res.Notes {
			fmt.Println("  note      " + note)
		}
	}
	return err
}

// runTenant implements `barepod tenant …`.
func runTenant(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: barepod tenant provision --username <name> [--quota 10GB] [--dry-run]")
	}
	switch args[0] {
	case "provision", "sync":
		return tenantProvision(args[1:])
	default:
		return fmt.Errorf("unknown tenant command %q", args[0])
	}
}

func tenantProvision(args []string) error {
	fs := flag.NewFlagSet("barepod tenant provision", flag.ContinueOnError)
	username := fs.String("username", "", "panel account name")
	quota := fs.String("quota", "", "disk quota (defaults to the account's package limit)")
	dryRun := fs.Bool("dry-run", false, "record the commands instead of running them")
	dbPath := fs.String("db", config.DefaultDBPath(), "path to the panel database")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *username == "" && len(fs.Args()) == 1 {
		*username = fs.Args()[0]
	}
	if *username == "" {
		return errors.New("usage: barepod tenant provision --username <name> [--quota 10GB]")
	}

	st, err := openStoreForCLI(*dbPath)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()

	account, err := st.UserByUsername(*username)
	if err != nil {
		return fmt.Errorf("panel account %q does not exist — create it first with `barepod user create`", *username)
	}
	group, err := st.GroupByName(account.GroupName)
	if err != nil {
		return fmt.Errorf("the account is in group %q, which no longer exists", account.GroupName)
	}

	fmt.Printf("Package %q limits: %s\n", group.Name, group.Limits.Describe())
	return provisionOSUser(st, *username, group, *quota, *dryRun)
}

// runGroup implements `barepod group list`.
func runGroup(args []string) error {
	if len(args) == 0 {
		return groupList(nil)
	}
	if args[0] == "list" {
		return groupList(args[1:])
	}
	return fmt.Errorf("unknown group command %q (only \"list\" exists)", args[0])
}

func groupList(args []string) error {
	fs := flag.NewFlagSet("barepod group list", flag.ContinueOnError)
	dbPath := fs.String("db", config.DefaultDBPath(), "path to the panel database")
	if err := fs.Parse(args); err != nil {
		return err
	}

	st, err := openStoreForCLI(*dbPath)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()

	groups, err := st.ListGroups()
	if err != nil {
		return err
	}
	capacity := resources.DetectCapacity(config.DefaultSitesRoot())
	for _, g := range groups {
		fmt.Printf("%-20s members=%d%s\n", g.Name, g.Members, systemSuffix(g.IsSystem))
		fmt.Printf("%-20s limits: %s\n", "", g.Limits.Describe())
	}
	fmt.Printf("\nHost: %d cores, %d MiB RAM, %d GiB disk (%d GiB free)\n",
		capacity.CPUCores, capacity.MemoryMB, capacity.DiskGB, capacity.DiskFreeGB)
	return nil
}

func systemSuffix(isSystem bool) string {
	if isSystem {
		return "  (built-in)"
	}
	return ""
}
