package framework

import (
	"archive/zip"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// DetectedFramework holds framework, runtime, build, and infrastructure recommendations
// inferred from project files (composer.json, package.json, requirements.txt, etc.).
type DetectedFramework struct {
	Name             string   `json:"name"`                      // e.g. "laravel", "nextjs", "vite", "astro", "express", "django", "fastapi", "static"
	Title            string   `json:"title"`                     // e.g. "Laravel 12", "Next.js", "Vite (React/Vue SPA)"
	FrameworkVersion string   `json:"frameworkVersion,omitempty"` // e.g. "12.70.0" or "12"
	MinPHPVersion    string   `json:"minPhpVersion,omitempty"`    // e.g. "8.2"
	CompatiblePHP    []string `json:"compatiblePhp,omitempty"`    // e.g. ["8.2", "8.3", "8.4"]
	Runtime          string   `json:"runtime"`                   // "php" | "nodejs" | "python" | "static" | "go"
	Version          string   `json:"version"`                   // e.g. "8.4" for PHP, "22" for Node, "3.12" for Python
	PackageManager   string   `json:"packageManager"`            // "npm", "pnpm", "yarn", "bun", "composer", "pip"
	DocRoot          string   `json:"docRoot"`                   // "public", "dist", "build", "."
	BuildCommand     string   `json:"buildCommand"`              // e.g. "composer install..." or "npm run build"
	StartCommand     string   `json:"startCommand"`              // e.g. "npm start"
	Port             int      `json:"port"`                      // e.g. 3000, 5000, 8001
	DatabaseEngine   string   `json:"databaseEngine"`            // "mariadb", "postgres", "sqlite", ""
	CacheEngine      string   `json:"cacheEngine"`               // "redis", ""
	IsProxy          bool     `json:"isProxy"`                   // true if node/python service behind reverse proxy
}

type composerJSON struct {
	Require    map[string]string `json:"require"`
	RequireDev map[string]string `json:"require-dev"`
}

type packageJSON struct {
	Dependencies    map[string]string `json:"dependencies"`
	DevDependencies map[string]string `json:"devDependencies"`
	Scripts         map[string]string `json:"scripts"`
}

// Detect inspects a filesystem directory and returns detected framework metadata.
func Detect(dir string) *DetectedFramework {
	if dir == "" {
		return nil
	}

	// 1. Check PHP / Composer
	composerPath := filepath.Join(dir, "composer.json")
	if data, err := os.ReadFile(composerPath); err == nil {
		if fw := detectFromComposer(data, dir); fw != nil {
			return fw
		}
	}

	// 2. Check WordPress wp-config.php if no composer
	if _, err := os.Stat(filepath.Join(dir, "wp-config.php")); err == nil {
		wpVer := ""
		if verBytes, err := os.ReadFile(filepath.Join(dir, "wp-includes", "version.php")); err == nil {
			for _, line := range strings.Split(string(verBytes), "\n") {
				if strings.Contains(line, "$wp_version =") {
					parts := strings.Split(line, "'")
					if len(parts) >= 2 {
						wpVer = parts[1]
					}
				}
			}
		}
		title := "WordPress"
		if wpVer != "" {
			title = "WordPress " + wpVer
		}
		return &DetectedFramework{
			Name:             "wordpress",
			Title:            title,
			FrameworkVersion: wpVer,
			MinPHPVersion:    "7.4",
			CompatiblePHP:    []string{"7.4", "8.0", "8.1", "8.2", "8.3", "8.4"},
			Runtime:          "php",
			Version:          "8.3",
			PackageManager:   "composer",
			DocRoot:          ".",
			DatabaseEngine:   "mariadb",
			Port:             8001,
		}
	}

	// 3. Check Node.js / JavaScript / TypeScript
	pkgPath := filepath.Join(dir, "package.json")
	if data, err := os.ReadFile(pkgPath); err == nil {
		pm := detectPackageManager(dir)
		if fw := detectFromPackageJSON(data, pm, dir); fw != nil {
			return fw
		}
	}

	// 4. Check Python
	reqPath := filepath.Join(dir, "requirements.txt")
	pyprojectPath := filepath.Join(dir, "pyproject.toml")
	if data, err := os.ReadFile(reqPath); err == nil {
		return detectFromPython(string(data))
	} else if data, err := os.ReadFile(pyprojectPath); err == nil {
		return detectFromPython(string(data))
	}

	// 5. Check Go
	if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
		return &DetectedFramework{
			Name:           "go",
			Title:          "Go Application",
			Runtime:        "go",
			Version:        "1.22",
			BuildCommand:   "go build -o app .",
			StartCommand:   "./app",
			Port:           8080,
			DocRoot:        ".",
			IsProxy:        true,
			DatabaseEngine: "postgres",
		}
	}

	// 6. Check Static HTML
	if _, err := os.Stat(filepath.Join(dir, "index.html")); err == nil {
		return &DetectedFramework{
			Name:    "static",
			Title:   "Static HTML",
			Runtime: "static",
			DocRoot: ".",
			Port:    80,
		}
	}

	return nil
}

// DetectArchive inspects a ZIP archive in-memory without fully unpacking to disk.
func DetectArchive(r io.ReaderAt, size int64) *DetectedFramework {
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return nil
	}

	var composerBytes, pkgBytes []byte
	var reqStr string
	hasWP := false
	hasIndexHTML := false
	hasGoMod := false
	hasPnpmLock := false
	hasYarnLock := false
	hasBunLock := false

	for _, f := range zr.File {
		name := filepath.Base(f.Name)
		switch name {
		case "composer.json":
			if rc, err := f.Open(); err == nil {
				composerBytes, _ = io.ReadAll(io.LimitReader(rc, 256*1024))
				_ = rc.Close()
			}
		case "package.json":
			if rc, err := f.Open(); err == nil {
				pkgBytes, _ = io.ReadAll(io.LimitReader(rc, 256*1024))
				_ = rc.Close()
			}
		case "requirements.txt", "pyproject.toml":
			if rc, err := f.Open(); err == nil {
				data, _ := io.ReadAll(io.LimitReader(rc, 128*1024))
				reqStr = string(data)
				_ = rc.Close()
			}
		case "wp-config.php":
			hasWP = true
		case "go.mod":
			hasGoMod = true
		case "index.html":
			hasIndexHTML = true
		case "pnpm-lock.yaml":
			hasPnpmLock = true
		case "yarn.lock":
			hasYarnLock = true
		case "bun.lockb", "bun.lock":
			hasBunLock = true
		}
	}

	pm := "npm"
	if hasBunLock {
		pm = "bun"
	} else if hasPnpmLock {
		pm = "pnpm"
	} else if hasYarnLock {
		pm = "yarn"
	}

	if len(composerBytes) > 0 {
		if fw := detectFromComposer(composerBytes, ""); fw != nil {
			return fw
		}
	}
	if hasWP {
		return &DetectedFramework{
			Name:           "wordpress",
			Title:          "WordPress",
			Runtime:        "php",
			Version:        "8.3",
			DocRoot:        ".",
			DatabaseEngine: "mariadb",
			Port:           8001,
		}
	}
	if len(pkgBytes) > 0 {
		if fw := detectFromPackageJSON(pkgBytes, pm, ""); fw != nil {
			return fw
		}
	}
	if reqStr != "" {
		return detectFromPython(reqStr)
	}
	if hasGoMod {
		return &DetectedFramework{
			Name:           "go",
			Title:          "Go Application",
			Runtime:        "go",
			Version:        "1.22",
			BuildCommand:   "go build -o app .",
			StartCommand:   "./app",
			Port:           8080,
			DocRoot:        ".",
			IsProxy:        true,
			DatabaseEngine: "postgres",
		}
	}
	if hasIndexHTML {
		return &DetectedFramework{
			Name:    "static",
			Title:   "Static HTML",
			Runtime: "static",
			DocRoot: ".",
			Port:    80,
		}
	}

	return nil
}

func detectPackageManager(dir string) string {
	if _, err := os.Stat(filepath.Join(dir, "bun.lockb")); err == nil {
		return "bun"
	}
	if _, err := os.Stat(filepath.Join(dir, "bun.lock")); err == nil {
		return "bun"
	}
	if _, err := os.Stat(filepath.Join(dir, "pnpm-lock.yaml")); err == nil {
		return "pnpm"
	}
	if _, err := os.Stat(filepath.Join(dir, "yarn.lock")); err == nil {
		return "yarn"
	}
	return "npm"
}

func extractComposerPackageVersion(dir string, c *composerJSON, pkgName string) (fullVer, majorVer string) {
	if dir != "" {
		lockPath := filepath.Join(dir, "composer.lock")
		if lockBytes, err := os.ReadFile(lockPath); err == nil {
			var lock struct {
				Packages []struct {
					Name    string `json:"name"`
					Version string `json:"version"`
				} `json:"packages"`
			}
			if err := json.Unmarshal(lockBytes, &lock); err == nil {
				for _, p := range lock.Packages {
					if strings.EqualFold(p.Name, pkgName) {
						v := strings.TrimPrefix(p.Version, "v")
						fullVer = v
						parts := strings.Split(v, ".")
						if len(parts) > 0 {
							majorVer = parts[0]
						}
						return fullVer, majorVer
					}
				}
			}
		}
	}
	if c != nil && c.Require != nil {
		if reqVer, ok := c.Require[pkgName]; ok {
			clean := strings.TrimLeft(reqVer, "^~>=<v ")
			parts := strings.Split(clean, ".")
			if len(parts) > 0 && parts[0] != "" {
				majorVer = parts[0]
				fullVer = clean
				return fullVer, majorVer
			}
		}
	}
	return "", ""
}

func detectFromComposer(data []byte, dir string) *DetectedFramework {
	var c composerJSON
	if err := json.Unmarshal(data, &c); err != nil {
		return nil
	}

	allDeps := make(map[string]bool)
	for k := range c.Require {
		allDeps[strings.ToLower(k)] = true
	}
	for k := range c.RequireDev {
		allDeps[strings.ToLower(k)] = true
	}

	phpVer := "8.4"
	if req, ok := c.Require["php"]; ok {
		if strings.Contains(req, "8.1") {
			phpVer = "8.1"
		} else if strings.Contains(req, "8.2") {
			phpVer = "8.2"
		} else if strings.Contains(req, "8.3") {
			phpVer = "8.3"
		} else if strings.Contains(req, "8.4") {
			phpVer = "8.4"
		}
	}

	if allDeps["laravel/framework"] {
		fullVer, majorVer := extractComposerPackageVersion(dir, &c, "laravel/framework")
		title := "Laravel"
		if majorVer != "" {
			title = "Laravel " + majorVer
		}
		minPhp := "8.2"
		compatible := []string{"8.2", "8.3", "8.4"}
		if majorVer == "10" {
			minPhp = "8.1"
			compatible = []string{"8.1", "8.2", "8.3", "8.4"}
		} else if majorVer == "9" {
			minPhp = "8.0"
			compatible = []string{"8.0", "8.1", "8.2"}
		} else if majorVer == "8" {
			minPhp = "7.3"
			compatible = []string{"7.3", "7.4", "8.0", "8.1"}
		} else if majorVer != "" && (majorVer == "7" || majorVer == "6" || majorVer == "5") {
			minPhp = "7.1"
			compatible = []string{"7.1", "7.2", "7.3", "7.4"}
		}
		if req, ok := c.Require["php"]; ok {
			if strings.Contains(req, "8.2") || strings.Contains(req, "8.3") || strings.Contains(req, "8.4") {
				minPhp = "8.2"
				compatible = []string{"8.2", "8.3", "8.4"}
			} else if strings.Contains(req, "8.1") {
				minPhp = "8.1"
				compatible = []string{"8.1", "8.2", "8.3", "8.4"}
			}
		}

		return &DetectedFramework{
			Name:             "laravel",
			Title:            title,
			FrameworkVersion: fullVer,
			MinPHPVersion:    minPhp,
			CompatiblePHP:    compatible,
			Runtime:          "php",
			Version:          phpVer,
			PackageManager:   "composer",
			DocRoot:          "public",
			BuildCommand:     "composer install --no-dev --optimize-autoloader && php artisan config:cache && php artisan route:cache && php artisan view:cache && php artisan migrate --force",
			DatabaseEngine:   "mariadb",
			CacheEngine:      "redis",
			Port:             8001,
		}
	}

	if allDeps["symfony/framework-bundle"] || allDeps["symfony/flex"] {
		return &DetectedFramework{
			Name:           "symfony",
			Title:          "Symfony",
			Runtime:        "php",
			Version:        phpVer,
			PackageManager: "composer",
			DocRoot:        "public",
			BuildCommand:   "composer install --no-dev --optimize-autoloader",
			DatabaseEngine: "postgres",
			Port:           8001,
		}
	}

	if allDeps["roots/bedrock"] {
		return &DetectedFramework{
			Name:           "wordpress",
			Title:          "WordPress (Bedrock)",
			Runtime:        "php",
			Version:        phpVer,
			PackageManager: "composer",
			DocRoot:        "web",
			DatabaseEngine: "mariadb",
			Port:           8001,
		}
	}

	// Generic PHP
	docRoot := "."
	if dir != "" {
		if fi, err := os.Stat(filepath.Join(dir, "public")); err == nil && fi.IsDir() {
			docRoot = "public"
		}
	}
	return &DetectedFramework{
		Name:           "php",
		Title:          "PHP Application",
		Runtime:        "php",
		Version:        phpVer,
		PackageManager: "composer",
		DocRoot:        docRoot,
		BuildCommand:   "composer install --no-dev --optimize-autoloader",
		DatabaseEngine: "mariadb",
		Port:           8001,
	}
}

func detectFromPackageJSON(data []byte, pm, dir string) *DetectedFramework {
	var p packageJSON
	if err := json.Unmarshal(data, &p); err != nil {
		return nil
	}

	allDeps := make(map[string]bool)
	for k := range p.Dependencies {
		allDeps[strings.ToLower(k)] = true
	}
	for k := range p.DevDependencies {
		allDeps[strings.ToLower(k)] = true
	}

	installCmd := pm + " install"
	if pm == "npm" {
		installCmd = "npm ci || npm install"
	}
	runCmd := pm + " run"

	// 1. Next.js
	if allDeps["next"] {
		return &DetectedFramework{
			Name:           "nextjs",
			Title:          "Next.js",
			Runtime:        "nodejs",
			Version:        "22",
			PackageManager: pm,
			DocRoot:        ".",
			BuildCommand:   installCmd + " && " + runCmd + " build",
			StartCommand:   runCmd + " start",
			Port:           3000,
			IsProxy:        true,
			DatabaseEngine: "postgres",
		}
	}

	// 2. Nuxt
	if allDeps["nuxt"] || allDeps["nuxt3"] {
		return &DetectedFramework{
			Name:           "nuxt",
			Title:          "Nuxt",
			Runtime:        "nodejs",
			Version:        "22",
			PackageManager: pm,
			DocRoot:        ".",
			BuildCommand:   installCmd + " && " + runCmd + " build",
			StartCommand:   "node .output/server/index.mjs",
			Port:           3000,
			IsProxy:        true,
			DatabaseEngine: "postgres",
		}
	}

	// 3. Astro
	if allDeps["astro"] {
		return &DetectedFramework{
			Name:           "astro",
			Title:          "Astro",
			Runtime:        "static",
			PackageManager: pm,
			DocRoot:        "dist",
			BuildCommand:   installCmd + " && " + runCmd + " build",
			Port:           80,
		}
	}

	// 4. Vite SPA (React, Vue, Svelte, Preact)
	if allDeps["vite"] || allDeps["@vitejs/plugin-react"] || allDeps["@vitejs/plugin-vue"] || allDeps["vue"] || allDeps["svelte"] {
		return &DetectedFramework{
			Name:           "vite",
			Title:          "Vite SPA (React/Vue)",
			Runtime:        "static",
			PackageManager: pm,
			DocRoot:        "dist",
			BuildCommand:   installCmd + " && " + runCmd + " build",
			Port:           80,
		}
	}

	// 5. Create React App
	if allDeps["react-scripts"] {
		return &DetectedFramework{
			Name:           "react",
			Title:          "React SPA",
			Runtime:        "static",
			PackageManager: pm,
			DocRoot:        "build",
			BuildCommand:   installCmd + " && " + runCmd + " build",
			Port:           80,
		}
	}

	// 6. Backend Node.js service (Express, NestJS, Fastify, Koa)
	if allDeps["express"] || allDeps["@nestjs/core"] || allDeps["fastify"] || allDeps["koa"] {
		buildCmd := installCmd
		if _, hasBuild := p.Scripts["build"]; hasBuild {
			buildCmd += " && " + runCmd + " build"
		}
		startCmd := runCmd + " start"
		if _, hasStart := p.Scripts["start"]; !hasStart {
			startCmd = "node index.js"
		}
		title := "Express / Node.js API"
		if allDeps["@nestjs/core"] {
			title = "NestJS Application"
		}
		return &DetectedFramework{
			Name:           "express",
			Title:          title,
			Runtime:        "nodejs",
			Version:        "22",
			PackageManager: pm,
			DocRoot:        ".",
			BuildCommand:   buildCmd,
			StartCommand:   startCmd,
			Port:           3000,
			IsProxy:        true,
			DatabaseEngine: "postgres",
		}
	}

	// Generic Node.js
	buildCmd := installCmd
	if _, hasBuild := p.Scripts["build"]; hasBuild {
		buildCmd += " && " + runCmd + " build"
	}
	return &DetectedFramework{
		Name:           "nodejs",
		Title:          "Node.js App",
		Runtime:        "nodejs",
		Version:        "22",
		PackageManager: pm,
		DocRoot:        ".",
		BuildCommand:   buildCmd,
		StartCommand:   runCmd + " start",
		Port:           3000,
		IsProxy:        true,
	}
}

func detectFromPython(content string) *DetectedFramework {
	lower := strings.ToLower(content)
	if strings.Contains(lower, "django") {
		return &DetectedFramework{
			Name:           "django",
			Title:          "Django",
			Runtime:        "python",
			Version:        "3.12",
			PackageManager: "pip",
			DocRoot:        ".",
			BuildCommand:   "pip install -r requirements.txt && python manage.py migrate --noinput",
			StartCommand:   "python manage.py runserver 127.0.0.1:8000",
			Port:           8000,
			IsProxy:        true,
			DatabaseEngine: "postgres",
		}
	}
	if strings.Contains(lower, "fastapi") {
		return &DetectedFramework{
			Name:           "fastapi",
			Title:          "FastAPI",
			Runtime:        "python",
			Version:        "3.12",
			PackageManager: "pip",
			DocRoot:        ".",
			BuildCommand:   "pip install -r requirements.txt",
			StartCommand:   "uvicorn main:app --host 127.0.0.1 --port 5000",
			Port:           5000,
			IsProxy:        true,
			DatabaseEngine: "postgres",
		}
	}
	return &DetectedFramework{
		Name:           "flask",
		Title:          "Flask / Python",
		Runtime:        "python",
		Version:        "3.12",
		PackageManager: "pip",
		DocRoot:        ".",
		BuildCommand:   "pip install -r requirements.txt",
		StartCommand:   "python app.py",
		Port:           5000,
		IsProxy:        true,
	}
}
