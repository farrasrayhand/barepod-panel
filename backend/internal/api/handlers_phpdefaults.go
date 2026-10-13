package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/phpext"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

const phpDefaultsKey = "php_defaults"

type PhpDefaultsConfig struct {
	MemoryLimit                string   `json:"memoryLimit"`
	UploadMaxSize              string   `json:"uploadMaxSize"`
	PostMaxSize                string   `json:"postMaxSize"`
	MaxExecutionTime           int      `json:"maxExecutionTime"`
	MaxInputTime               int      `json:"maxInputTime"`
	MaxInputVars               int      `json:"maxInputVars"`
	OpcacheEnable              bool     `json:"opcacheEnable"`
	OpcacheMemoryConsumption   int      `json:"opcacheMemoryConsumption"`
	OpcacheMaxAcceleratedFiles int      `json:"opcacheMaxAcceleratedFiles"`
	OpcacheValidateTimestamps  bool     `json:"opcacheValidateTimestamps"`
	OpcacheRevalidateFreq      int      `json:"opcacheRevalidateFreq"`
	RecommendedExtensions      []string `json:"recommendedExtensions"`
}

func defaultPhpBlueprint() PhpDefaultsConfig {
	return PhpDefaultsConfig{
		MemoryLimit:                "256M",
		UploadMaxSize:              "64M",
		PostMaxSize:                "64M",
		MaxExecutionTime:           60,
		MaxInputTime:               60,
		MaxInputVars:               3000,
		OpcacheEnable:              true,
		OpcacheMemoryConsumption:   128,
		OpcacheMaxAcceleratedFiles: 10000,
		OpcacheValidateTimestamps:  true,
		OpcacheRevalidateFreq:      2,
		RecommendedExtensions: []string{
			"curl", "mbstring", "openssl", "pdo_mysql", "pdo_pgsql", "gd", "zip", "intl", "bcmath", "redis", "opcache",
		},
	}
}

// handleGetPhpDefaults returns the global PHP blueprint tuning preset and installed versions.
func (s *Server) handleGetPhpDefaults(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	cfg := defaultPhpBlueprint()
	raw, err := s.store.PanelSetting(phpDefaultsKey)
	if err == nil && raw != "" {
		_ = json.Unmarshal([]byte(raw), &cfg)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"config":            cfg,
		"installedVersions": phpext.InstalledVersions(),
	})
}

// handleSavePhpDefaults saves the global preset and optionally applies tuning to all installed PHP versions on the host.
func (s *Server) handleSavePhpDefaults(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var body struct {
		Config      PhpDefaultsConfig `json:"config"`
		ApplyToHost bool              `json:"applyToHost"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "could not parse php defaults json")
		return
	}

	cfg := body.Config
	if cfg.MemoryLimit == "" {
		cfg.MemoryLimit = "256M"
	}
	if cfg.UploadMaxSize == "" {
		cfg.UploadMaxSize = "64M"
	}
	if cfg.PostMaxSize == "" {
		cfg.PostMaxSize = "64M"
	}
	if cfg.MaxExecutionTime <= 0 {
		cfg.MaxExecutionTime = 60
	}
	if cfg.MaxInputTime <= 0 {
		cfg.MaxInputTime = 60
	}
	if cfg.MaxInputVars <= 0 {
		cfg.MaxInputVars = 3000
	}

	data, err := json.Marshal(cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "marshal_error", err.Error())
		return
	}

	if err := s.store.SavePanelSetting(phpDefaultsKey, string(data)); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	_ = s.store.Audit(user.ID, "panel.php_defaults", "update", clientIP(r), "updated global php blueprint preset")

	if body.ApplyToHost && s.host.Materialises() {
		opcacheVal := 0
		if cfg.OpcacheEnable {
			opcacheVal = 1
		}
		validateVal := 0
		if cfg.OpcacheValidateTimestamps {
			validateVal = 1
		}
		iniContent := fmt.Sprintf(`; Managed by BarePod Panel Global PHP Tuning Blueprint
memory_limit = %s
upload_max_filesize = %s
post_max_size = %s
max_execution_time = %d
max_input_time = %d
max_input_vars = %d
opcache.enable = %d
opcache.enable_cli = %d
opcache.memory_consumption = %d
opcache.max_accelerated_files = %d
opcache.validate_timestamps = %d
opcache.revalidate_freq = %d
`,
			cfg.MemoryLimit, cfg.UploadMaxSize, cfg.PostMaxSize,
			cfg.MaxExecutionTime, cfg.MaxInputTime, cfg.MaxInputVars,
			opcacheVal, opcacheVal,
			cfg.OpcacheMemoryConsumption, cfg.OpcacheMaxAcceleratedFiles,
			validateVal, cfg.OpcacheRevalidateFreq,
		)

		for _, ver := range phpext.InstalledVersions() {
			modsDir := filepath.Join("/etc/php", ver, "mods-available")
			if err := os.MkdirAll(modsDir, 0o755); err == nil {
				tuningPath := filepath.Join(modsDir, "99-barepod-tuning.ini")
				_ = os.WriteFile(tuningPath, []byte(iniContent), 0o644)
				_, _ = s.host.Run(r.Context(), []string{"phpenmod", "-v", ver, "99-barepod-tuning"})
				for _, ext := range cfg.RecommendedExtensions {
					ext = strings.TrimSpace(ext)
					if ext == "" {
						continue
					}
					iniFile := filepath.Join(modsDir, ext+".ini")
					if _, statErr := os.Stat(iniFile); statErr == nil {
						_, _ = s.host.Run(r.Context(), []string{"phpenmod", "-v", ver, ext})
					}
				}
				_, _ = s.host.Run(r.Context(), []string{"systemctl", "reload", "php" + ver + "-fpm"})
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success":           true,
		"config":            cfg,
		"installedVersions": phpext.InstalledVersions(),
	})
}
