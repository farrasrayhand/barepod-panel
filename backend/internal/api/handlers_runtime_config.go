package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/phpext"
	"github.com/farrasrayhand/barepod-panel/backend/internal/phpfpm"
	"github.com/farrasrayhand/barepod-panel/backend/internal/provision"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/supervisor"
)

// handleGetRuntimeConfig returns the runtime configuration and environment options for a website.
func (s *Server) handleGetRuntimeConfig(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	site, ok := s.siteOr404(w, r, user)
	if !ok {
		return
	}

	siteDir := s.host.SitePath(site.TenantUser, site.Slug)
	settingKey := "site_runtime_config:" + site.Slug
	raw, _ := s.store.PanelSetting(settingKey)

	var savedConfig map[string]any
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &savedConfig)
	}
	if savedConfig == nil {
		savedConfig = map[string]any{}
	}

	resConfig := map[string]any{}
	runtime := strings.ToLower(strings.TrimSpace(site.Runtime))

	switch runtime {
	case "php":
		// Load baseline from global blueprint if not overridden
		blueprint := defaultPhpBlueprint()
		if globalRaw, err := s.store.PanelSetting(phpDefaultsKey); err == nil && globalRaw != "" {
			_ = json.Unmarshal([]byte(globalRaw), &blueprint)
		}

		resConfig["memoryLimit"] = stringVal(savedConfig["memoryLimit"], blueprint.MemoryLimit)
		resConfig["uploadMaxSize"] = stringVal(savedConfig["uploadMaxSize"], blueprint.UploadMaxSize)
		resConfig["postMaxSize"] = stringVal(savedConfig["postMaxSize"], blueprint.PostMaxSize)
		resConfig["maxExecutionTime"] = intVal(savedConfig["maxExecutionTime"], blueprint.MaxExecutionTime)
		resConfig["maxInputVars"] = intVal(savedConfig["maxInputVars"], blueprint.MaxInputVars)
		resConfig["maxInputTime"] = intVal(savedConfig["maxInputTime"], blueprint.MaxInputTime)
		resConfig["maxChildren"] = intVal(savedConfig["maxChildren"], 5)
		resConfig["processIdleTimeout"] = stringVal(savedConfig["processIdleTimeout"], "10s")

		// Extension status for this PHP version
		phpVer := site.Version
		if phpVer == "" {
			phpVer = "8.3"
		}
		resConfig["installedVersions"] = phpext.InstalledVersions()
		if rep, err := phpext.List(r.Context(), s.host, phpVer); err == nil {
			resConfig["extensions"] = rep.Extensions
			resConfig["installable"] = rep.Installable
		} else {
			resConfig["extensions"] = []phpext.Extension{}
			resConfig["installable"] = []string{}
		}

	case "nodejs":
		pkgManager := "npm"
		if fileExists(filepath.Join(siteDir, "pnpm-lock.yaml")) {
			pkgManager = "pnpm"
		} else if fileExists(filepath.Join(siteDir, "yarn.lock")) {
			pkgManager = "yarn"
		}

		detectedScripts := []string{"start", "dev", "build"}
		if pkgBytes, err := os.ReadFile(filepath.Join(siteDir, "package.json")); err == nil {
			var pkgJson struct {
				Scripts map[string]string `json:"scripts"`
			}
			if err := json.Unmarshal(pkgBytes, &pkgJson); err == nil && len(pkgJson.Scripts) > 0 {
				detectedScripts = make([]string, 0, len(pkgJson.Scripts))
				for k := range pkgJson.Scripts {
					detectedScripts = append(detectedScripts, k)
				}
			}
		}

		savedScript := stringVal(savedConfig["script"], "")
		if savedScript == "" {
			savedScript = stringVal(savedConfig["startScript"], "start")
		}
		resConfig["packageManager"] = stringVal(savedConfig["packageManager"], pkgManager)
		resConfig["script"] = savedScript
		resConfig["startScript"] = savedScript
		resConfig["entrypoint"] = stringVal(savedConfig["entrypoint"], "npm start")
		resConfig["memoryLimitMb"] = intVal(savedConfig["memoryLimitMb"], 0)
		resConfig["detectedScripts"] = detectedScripts

	case "python":
		wsgiServer := "gunicorn"
		if strings.EqualFold(site.Framework, "fastapi") {
			wsgiServer = "uvicorn"
		}

		venvExists := fileExists(filepath.Join(siteDir, ".venv"))
		savedWsgi := stringVal(savedConfig["wsgiServer"], "")
		if savedWsgi == "" {
			savedWsgi = stringVal(savedConfig["runner"], wsgiServer)
		}
		resConfig["wsgiServer"] = savedWsgi
		resConfig["runner"] = savedWsgi
		resConfig["workers"] = intVal(savedConfig["workers"], 2)
		resConfig["threads"] = intVal(savedConfig["threads"], 1)
		resConfig["timeout"] = intVal(savedConfig["timeout"], 60)
		resConfig["venvExists"] = venvExists
		resConfig["venvPath"] = filepath.Join(siteDir, ".venv")

	case "ruby":
		resConfig["appServer"] = stringVal(savedConfig["appServer"], "puma")
		resConfig["workers"] = intVal(savedConfig["workers"], 2)
		resConfig["threads"] = intVal(savedConfig["threads"], 5)

	case "go", "rust":
		defaultBin := "./bin/app"
		if runtime == "rust" {
			defaultBin = "./target/release/app"
		}
		resConfig["binaryPath"] = stringVal(savedConfig["binaryPath"], defaultBin)
		resConfig["args"] = stringVal(savedConfig["args"], "")
		resConfig["port"] = site.Port

	case "static":
		resConfig["spaFallback"] = boolVal(savedConfig["spaFallback"], true)
		resConfig["docRoot"] = stringVal(savedConfig["docRoot"], "public")

	case "proxy":
		resConfig["upstreamUrl"] = stringVal(savedConfig["upstreamUrl"], fmt.Sprintf("http://127.0.0.1:%d", site.Port))
		resConfig["websocket"] = boolVal(savedConfig["websocket"], true)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"runtime": site.Runtime,
		"version": site.Version,
		"config":  resConfig,
	})
}

// handleSaveRuntimeConfig updates runtime configuration and reapplies it to the host process.
func (s *Server) handleSaveRuntimeConfig(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	site, ok := s.siteOr404(w, r, user)
	if !ok {
		return
	}

	var req struct {
		Config map[string]any `json:"config"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	if req.Config == nil {
		req.Config = map[string]any{}
	}

	if verVal, ok := req.Config["version"]; ok {
		if verStr := strings.TrimSpace(fmt.Sprint(verVal)); verStr != "" && verStr != site.Version {
			_ = s.store.UpdateWebsiteVersion(site.Slug, verStr)
			site.Version = verStr
			_ = s.store.Audit(user.ID, "website.version_change", site.Slug, clientIP(r), "new_version="+verStr)
		}
	}

	siteDir := s.host.SitePath(site.TenantUser, site.Slug)
	runtime := strings.ToLower(strings.TrimSpace(site.Runtime))
	limits := s.limitsForTenant(site.TenantUser)

	switch runtime {
	case "php":
		// Construct phpfpm.Spec with custom directives
		directives := phpfpm.Directives{
			MemoryLimit:        stringVal(req.Config["memoryLimit"], "256M"),
			UploadMaxSize:      stringVal(req.Config["uploadMaxSize"], "64M"),
			PostMaxSize:        stringVal(req.Config["postMaxSize"], "64M"),
			MaxExecutionTime:   intVal(req.Config["maxExecutionTime"], 60),
			MaxInputVars:       intVal(req.Config["maxInputVars"], 3000),
			MaxInputTime:       intVal(req.Config["maxInputTime"], 60),
			ProcessIdleTimeout: stringVal(req.Config["processIdleTimeout"], "10s"),
		}

		maxChildren := intVal(req.Config["maxChildren"], phpfpm.MaxChildren(limits.MemoryMB))
		if maxChildren <= 0 {
			maxChildren = 5
		}

		spec := phpfpm.Spec{
			Tenant:      site.TenantUser,
			SiteDir:     siteDir,
			Socket:      phpfpm.SocketIn(siteDir),
			MaxChildren: maxChildren,
			MemoryMB:    limits.MemoryMB,
			Directives:  directives,
		}

		if _, err := phpfpm.Write(r.Context(), s.host, spec); err != nil {
			writeError(w, http.StatusInternalServerError, "pool_write_failed", "Failed to write PHP-FPM pool: "+err.Error())
			return
		}

		if s.host.Materialises() {
			_, _ = s.host.ServiceAction(r.Context(), "restart", site.Slug)
		}

	case "nodejs":
		memLimitMb := intVal(req.Config["memoryLimitMb"], 0)
		script := stringVal(req.Config["script"], "")
		if script == "" {
			script = stringVal(req.Config["startScript"], "start")
		}
		pkgManager := stringVal(req.Config["packageManager"], "npm")
		req.Config["script"] = script
		req.Config["startScript"] = script
		req.Config["packageManager"] = pkgManager
		req.Config["memoryLimitMb"] = memLimitMb
		portStr := strconv.Itoa(site.Port)

		var execStart []string
		if script == "start" {
			execStart = []string{pkgManager, "start", "--", "--port", portStr}
		} else {
			execStart = []string{pkgManager, "run", script, "--", "--port", portStr}
		}

		extraEnv := map[string]string{}
		if memLimitMb > 0 {
			extraEnv["NODE_OPTIONS"] = fmt.Sprintf("--max-old-space-size=%d", memLimitMb)
		}

		unitSpec := supervisor.Spec{
			Slug:        site.Slug,
			Tenant:      site.TenantUser,
			Runtime:     site.Runtime,
			Version:     site.Version,
			Framework:   site.Framework,
			WorkDir:     siteDir,
			EnvFile:     filepath.Join(siteDir, ".env"),
			ExecStart:   execStart,
			Port:        site.Port,
			MemoryMaxMB: limits.MemoryMB,
			CPUQuota:    limits.CPUQuotaPercent,
			TasksMax:    limits.TasksMax,
			ExtraEnv:    extraEnv,
		}

		if _, _, err := supervisor.Write(s.host.UnitsDir, unitSpec); err != nil {
			writeError(w, http.StatusInternalServerError, "supervisor_failed", "Failed to update systemd drop-in: "+err.Error())
			return
		}

		if s.host.Materialises() {
			_, _ = s.host.Runner.Run(r.Context(), "", "systemctl", "daemon-reload")
			_, _ = s.host.ServiceAction(r.Context(), "restart", site.Slug)
		}

	case "python":
		wsgiServer := stringVal(req.Config["wsgiServer"], "")
		if wsgiServer == "" {
			wsgiServer = stringVal(req.Config["runner"], "gunicorn")
		}
		workers := intVal(req.Config["workers"], 2)
		timeout := intVal(req.Config["timeout"], 60)
		req.Config["wsgiServer"] = wsgiServer
		req.Config["runner"] = wsgiServer
		req.Config["workers"] = workers
		req.Config["timeout"] = timeout
		portStr := strconv.Itoa(site.Port)

		var execStart []string
		venvGunicorn := filepath.Join(siteDir, ".venv", "bin", "gunicorn")
		venvUvicorn := filepath.Join(siteDir, ".venv", "bin", "uvicorn")

		if wsgiServer == "uvicorn" {
			execStart = []string{
				venvUvicorn, "app:app",
				"--host", "127.0.0.1",
				"--port", portStr,
				"--workers", strconv.Itoa(workers),
				"--timeout-keep-alive", strconv.Itoa(timeout),
			}
		} else {
			args := []string{
				venvGunicorn,
				"-b", "127.0.0.1:" + portStr,
				"--workers", strconv.Itoa(workers),
				"--timeout", strconv.Itoa(timeout),
			}
			if strings.EqualFold(site.Framework, "fastapi") {
				args = append(args, "-k", "uvicorn.workers.UvicornWorker")
			}
			execStart = append(args, "app:app")
		}

		unitSpec := supervisor.Spec{
			Slug:        site.Slug,
			Tenant:      site.TenantUser,
			Runtime:     site.Runtime,
			Version:     site.Version,
			Framework:   site.Framework,
			WorkDir:     siteDir,
			EnvFile:     filepath.Join(siteDir, ".env"),
			ExecStart:   execStart,
			Port:        site.Port,
			MemoryMaxMB: limits.MemoryMB,
			CPUQuota:    limits.CPUQuotaPercent,
			TasksMax:    limits.TasksMax,
		}

		if _, _, err := supervisor.Write(s.host.UnitsDir, unitSpec); err != nil {
			writeError(w, http.StatusInternalServerError, "supervisor_failed", "Failed to update systemd drop-in: "+err.Error())
			return
		}

		if s.host.Materialises() {
			_, _ = s.host.Runner.Run(r.Context(), "", "systemctl", "daemon-reload")
			_, _ = s.host.ServiceAction(r.Context(), "restart", site.Slug)
		}

	case "ruby":
		workers := intVal(req.Config["workers"], 2)
		threads := intVal(req.Config["threads"], 5)
		portStr := strconv.Itoa(site.Port)

		execStart := []string{
			"bundle", "exec", "puma",
			"-p", portStr,
			"-w", strconv.Itoa(workers),
			"-t", fmt.Sprintf("%d:%d", threads, threads),
		}

		unitSpec := supervisor.Spec{
			Slug:        site.Slug,
			Tenant:      site.TenantUser,
			Runtime:     site.Runtime,
			Version:     site.Version,
			Framework:   site.Framework,
			WorkDir:     siteDir,
			EnvFile:     filepath.Join(siteDir, ".env"),
			ExecStart:   execStart,
			Port:        site.Port,
			MemoryMaxMB: limits.MemoryMB,
			CPUQuota:    limits.CPUQuotaPercent,
			TasksMax:    limits.TasksMax,
		}

		if _, _, err := supervisor.Write(s.host.UnitsDir, unitSpec); err != nil {
			writeError(w, http.StatusInternalServerError, "supervisor_failed", "Failed to update systemd drop-in: "+err.Error())
			return
		}

		if s.host.Materialises() {
			_, _ = s.host.Runner.Run(r.Context(), "", "systemctl", "daemon-reload")
			_, _ = s.host.ServiceAction(r.Context(), "restart", site.Slug)
		}

	case "go", "rust":
		binaryPath := stringVal(req.Config["binaryPath"], "")
		if binaryPath == "" {
			if runtime == "rust" {
				binaryPath = filepath.Join(siteDir, "target", "release", "app")
			} else {
				binaryPath = filepath.Join(siteDir, "bin", "app")
			}
		}
		if !filepath.IsAbs(binaryPath) {
			binaryPath = filepath.Join(siteDir, binaryPath)
		}

		execStart := []string{binaryPath}
		if customArgs := stringVal(req.Config["args"], ""); customArgs != "" {
			execStart = append(execStart, strings.Fields(customArgs)...)
		}

		unitSpec := supervisor.Spec{
			Slug:        site.Slug,
			Tenant:      site.TenantUser,
			Runtime:     site.Runtime,
			Version:     site.Version,
			Framework:   site.Framework,
			WorkDir:     siteDir,
			EnvFile:     filepath.Join(siteDir, ".env"),
			ExecStart:   execStart,
			Port:        site.Port,
			MemoryMaxMB: limits.MemoryMB,
			CPUQuota:    limits.CPUQuotaPercent,
			TasksMax:    limits.TasksMax,
		}

		if _, _, err := supervisor.Write(s.host.UnitsDir, unitSpec); err != nil {
			writeError(w, http.StatusInternalServerError, "supervisor_failed", "Failed to update systemd drop-in: "+err.Error())
			return
		}

		if s.host.Materialises() {
			_, _ = s.host.Runner.Run(r.Context(), "", "systemctl", "daemon-reload")
			_, _ = s.host.ServiceAction(r.Context(), "restart", site.Slug)
		}

	case "static":
		spa := boolVal(req.Config["spaFallback"], true)
		req.Config["spaFallback"] = spa
		_ = s.applyVhost(r, site)

	case "proxy":
		upUrl := stringVal(req.Config["upstreamUrl"], "")
		if upUrl != "" {
			req.Config["upstreamUrl"] = upUrl
			if m := regexp.MustCompile(`:(\d+)`).FindStringSubmatch(upUrl); len(m) > 1 {
				if newPort, err := strconv.Atoi(m[1]); err == nil && newPort > 0 && newPort != site.Port {
					_ = s.store.UpdateWebsitePort(site.Slug, newPort)
					site.Port = newPort
				}
			}
		}
		_ = s.applyVhost(r, site)

	default:
		// fallback to generic exec
		execStart := provision.ExecStart(site.Runtime, site.Version, site.Framework, siteDir, site.Port)
		unitSpec := supervisor.Spec{
			Slug:        site.Slug,
			Tenant:      site.TenantUser,
			Runtime:     site.Runtime,
			Version:     site.Version,
			Framework:   site.Framework,
			WorkDir:     siteDir,
			EnvFile:     filepath.Join(siteDir, ".env"),
			ExecStart:   execStart,
			Port:        site.Port,
			MemoryMaxMB: limits.MemoryMB,
			CPUQuota:    limits.CPUQuotaPercent,
			TasksMax:    limits.TasksMax,
		}
		_, _, _ = supervisor.Write(s.host.UnitsDir, unitSpec)
		if s.host.Materialises() {
			_, _ = s.host.Runner.Run(r.Context(), "", "systemctl", "daemon-reload")
			_, _ = s.host.ServiceAction(r.Context(), "restart", site.Slug)
		}
	}

	// Persist the custom configuration
	encoded, _ := json.Marshal(req.Config)
	_ = s.store.SavePanelSetting("site_runtime_config:"+site.Slug, string(encoded))
	_ = s.store.Audit(user.ID, "website.runtime_config", site.Slug, clientIP(r), site.Runtime)

	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "saved",
		"runtime":   site.Runtime,
		"config":    req.Config,
		"restarted": true,
		"mode":      s.host.Mode(),
	})
}

// Helpers
func stringVal(v any, def string) string {
	if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
		return strings.TrimSpace(s)
	}
	return def
}

func intVal(v any, def int) int {
	switch n := v.(type) {
	case int:
		return n
	case float64:
		return int(n)
	case string:
		if parsed, err := strconv.Atoi(strings.TrimSpace(n)); err == nil {
			return parsed
		}
	}
	return def
}

func boolVal(v any, def bool) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return def
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}
