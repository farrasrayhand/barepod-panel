package scheduler

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/phpfpm"
	"github.com/farrasrayhand/barepod-panel/backend/internal/provision"
	"github.com/farrasrayhand/barepod-panel/backend/internal/resources"
	"github.com/farrasrayhand/barepod-panel/backend/internal/supervisor"
)

const hostAutoTuneSigKey = "host_autotune_sig"

// reconcileRuntimeAutoTune checks if the host's RAM or CPU cores changed (scale up/down)
// and re-tunes all active websites that do not have manual runtime_config overrides.
func reconcileRuntimeAutoTune(ctx context.Context, env *Env) (string, error) {
	if env.Store == nil || env.Host == nil {
		return "store or host unavailable; skipping autotune", nil
	}
	hostMem := resources.DetectMemoryMB()
	hostCPU := resources.DetectCPUCores()
	sig := fmt.Sprintf("%d:%d", hostMem, hostCPU)

	if prev, err := env.Store.PanelSetting(hostAutoTuneSigKey); err == nil && prev == sig {
		return fmt.Sprintf("host specs unchanged (%d MiB RAM, %d vCPU)", hostMem, hostCPU), nil
	}

	sites, err := env.Store.ListWebsites()
	if err != nil {
		return "", fmt.Errorf("list websites: %w", err)
	}

	sharing, err := env.Store.Sharing()
	if err != nil {
		sharing = resources.Sharing{}
	}

	var tuned []string
	var needDaemonReload bool

	for _, site := range sites {
		if site.Status == "stopped" || site.Runtime == "static" || site.Runtime == "proxy" {
			continue
		}
		if manual, err := env.Store.PanelSetting("site_runtime_config:" + site.Slug); err == nil && strings.TrimSpace(manual) != "" {
			continue
		}

		limits := tenantLimitsForScheduler(env, site.TenantUser)
		siteDir := env.Host.SitePath(site.TenantUser, site.Slug)
		rt := strings.ToLower(strings.TrimSpace(site.Runtime))

		switch rt {
		case "php":
			spec := phpfpm.Spec{
				Tenant:      site.TenantUser,
				SiteDir:     siteDir,
				Socket:      phpfpm.SocketIn(siteDir),
				MaxChildren: phpfpm.MaxChildren(limits.MemoryMB),
				MemoryMB:    limits.MemoryMB,
			}
			if _, err := phpfpm.Write(ctx, env.Host, spec); err != nil {
				continue
			}
			if env.Host.Materialises() {
				_, _ = env.Host.ServiceAction(ctx, "reload-or-restart", site.Slug)
			}
			tuned = append(tuned, site.Slug+" (php)")

		case "nodejs", "python", "ruby", "go", "rust":
			cpuQuota, cpuWeight := resources.CPUPlan(limits, sharing)
			tune := resources.DetectRuntimeTune(limits.MemoryMB)
			extraEnv := map[string]string{}
			switch rt {
			case "nodejs":
				extraEnv["NODE_OPTIONS"] = fmt.Sprintf("--max-old-space-size=%d", tune.NodeMaxOldSpaceMB)
			case "go":
				extraEnv["GOMEMLIMIT"] = fmt.Sprintf("%dMiB", tune.GoMemLimitMB)
			}
			unitSpec := supervisor.Spec{
				Slug:          site.Slug,
				Tenant:        site.TenantUser,
				Runtime:       site.Runtime,
				Version:       site.Version,
				Framework:     site.Framework,
				WorkDir:       siteDir,
				EnvFile:       filepath.Join(siteDir, ".env"),
				ReadWritePath: filepath.Join(env.Host.SitesRoot, site.TenantUser),
				ExecStart:     provision.ExecStartForLimits(site.Runtime, site.Version, site.Framework, siteDir, site.Port, limits.MemoryMB),
				Port:          site.Port,
				MemoryMaxMB:   limits.MemoryMB,
				CPUQuota:      cpuQuota,
				CPUWeight:     cpuWeight,
				TasksMax:      limits.TasksMax,
				ExtraEnv:      extraEnv,
			}
			if _, _, err := supervisor.Write(env.Host.UnitsDir, unitSpec); err != nil {
				continue
			}
			needDaemonReload = true
			tuned = append(tuned, site.Slug+" ("+rt+")")
		}
	}

	if needDaemonReload && env.Host.Materialises() {
		_, _ = env.Host.ReloadUnits(ctx)
		for _, item := range tuned {
			if !strings.HasSuffix(item, "(php)") {
				slug := strings.SplitN(item, " ", 2)[0]
				_, _ = env.Host.ServiceAction(ctx, "restart", slug)
			}
		}
	}

	_ = env.Store.SavePanelSetting(hostAutoTuneSigKey, sig)
	if len(tuned) == 0 {
		return fmt.Sprintf("host specs updated to %d MiB RAM, %d vCPU; no auto-tuned sites needed changes", hostMem, hostCPU), nil
	}
	return fmt.Sprintf("host specs changed (%d MiB RAM, %d vCPU); re-tuned %d site(s): %s", hostMem, hostCPU, len(tuned), strings.Join(tuned, ", ")), nil
}

func tenantLimitsForScheduler(env *Env, tenant string) resources.Limits {
	account, err := env.Store.UserByUsername(tenant)
	if err != nil {
		return resources.Limits{}
	}
	group, err := env.Store.GroupByName(account.GroupName)
	if err != nil {
		return resources.Limits{}
	}
	return group.Limits
}
