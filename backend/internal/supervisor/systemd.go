// Package supervisor renders systemd units for websites.
//
// One template unit (barepod-app@.service) plus a per-site drop-in keeps the
// installation upgradeable: the template is versioned with the daemon, while
// each website only stores its own diff.
package supervisor

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// TemplateName is the shared template unit.
const TemplateName = "barepod-app@.service"

// Spec is everything a website needs to run as a service.
type Spec struct {
	Slug        string
	Tenant      string
	Runtime     string
	Version     string
	Framework   string
	WorkDir     string
	EnvFile     string
	ExecStart   []string
	Port        int
	MemoryMaxMB int
	CPUQuota    int // percent of one core, e.g. 100 = one full core
	TasksMax    int // max processes/threads
	Restart     string
	ExtraEnv    map[string]string
}

// Template returns the shared unit body (settings that never vary per site).
func Template() string {
	return `# Managed by BarePod Panel — do not edit.
# Per-site settings live in barepod-app@%i.service.d/override.conf
[Unit]
Description=BarePod website %i
Documentation=https://github.com/farrasrayhand/barepod-panel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Restart=on-failure
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=20
ExecStart=/bin/false
StandardOutput=journal
StandardError=journal
SyslogIdentifier=barepod-%i

[Install]
WantedBy=multi-user.target
`
}

// DropIn returns the per-site override, which is the only file that changes
// when a website is reconfigured.
func DropIn(s Spec) string {
	restart := s.Restart
	if restart == "" {
		restart = "on-failure"
	}

	var b strings.Builder
	b.WriteString("# Managed by BarePod Panel — generated from the website settings.\n")
	b.WriteString("[Service]\n")
	fmt.Fprintf(&b, "User=%s\n", s.Tenant)
	fmt.Fprintf(&b, "Group=%s\n", s.Tenant)
	fmt.Fprintf(&b, "WorkingDirectory=%s\n", s.WorkDir)
	if s.EnvFile != "" {
		fmt.Fprintf(&b, "EnvironmentFile=%s\n", s.EnvFile)
	}
	if s.Port > 0 {
		fmt.Fprintf(&b, "Environment=PORT=%d\n", s.Port)
	}
	for _, k := range sortedKeys(s.ExtraEnv) {
		fmt.Fprintf(&b, "Environment=%s=%s\n", k, s.ExtraEnv[k])
	}
	if len(s.ExecStart) > 0 {
		fmt.Fprintf(&b, "ExecStart=%s\n", strings.Join(s.ExecStart, " "))
	}
	fmt.Fprintf(&b, "Restart=%s\n", restart)
	if s.MemoryMaxMB > 0 {
		fmt.Fprintf(&b, "MemoryMax=%dM\n", s.MemoryMaxMB)
	}
	if s.CPUQuota > 0 {
		fmt.Fprintf(&b, "CPUQuota=%d%%\n", s.CPUQuota)
	}
	if s.TasksMax > 0 {
		fmt.Fprintf(&b, "TasksMax=%d\n", s.TasksMax)
	}
	b.WriteString("NoNewPrivileges=true\n")
	b.WriteString("PrivateTmp=true\n")
	b.WriteString("ProtectSystem=full\n")
	b.WriteString("ProtectHome=read-only\n")
	return b.String()
}

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
	return keys
}

// DropInDir is the override directory for a slug.
func DropInDir(unitsDir, slug string) string {
	return filepath.Join(unitsDir, "barepod-app@"+slug+".service.d")
}

// Write renders the template (shared) and the drop-in (per site).
// It returns the two absolute paths it wrote.
func Write(unitsDir string, s Spec) (templatePath, dropInPath string, err error) {
	if unitsDir == "" {
		return "", "", fmt.Errorf("supervisor: units directory is empty")
	}
	templatePath = filepath.Join(unitsDir, TemplateName)
	dropInPath = filepath.Join(DropInDir(unitsDir, s.Slug), "override.conf")

	if err := os.MkdirAll(unitsDir, 0o755); err != nil {
		return "", "", err
	}
	if err := os.WriteFile(templatePath, []byte(Template()), 0o644); err != nil {
		return "", "", err
	}
	if err := os.MkdirAll(filepath.Dir(dropInPath), 0o755); err != nil {
		return "", "", err
	}
	if err := os.WriteFile(dropInPath, []byte(DropIn(s)), 0o644); err != nil {
		return "", "", err
	}
	return templatePath, dropInPath, nil
}

// Remove deletes a website's drop-in (used when a website is deleted).
func Remove(unitsDir, slug string) error {
	return os.RemoveAll(DropInDir(unitsDir, slug))
}
