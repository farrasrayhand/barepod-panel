package supervisor

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDropInResetsExecStartBeforeSettingIt(t *testing.T) {
	// ExecStart is a list setting: without the empty assignment the template's
	// placeholder survives and systemd rejects the unit with "more than one
	// ExecStart= setting" — found on a real systemd host, not in theory.
	spec := Spec{
		Slug:      "demo",
		Tenant:    "tester",
		WorkDir:   "/home/tester/apps/demo",
		ExecStart: []string{"/home/tester/apps/demo/.venv/bin/gunicorn", "-b", "127.0.0.1:9101", "app:app"},
	}

	out := DropIn(spec)
	reset := strings.Index(out, "\nExecStart=\n")
	command := strings.Index(out, "ExecStart=/home/tester/apps/demo/.venv/bin/gunicorn")
	if reset < 0 || command < 0 {
		t.Fatalf("drop-in must clear then set ExecStart, got:\n%s", out)
	}
	if reset > command {
		t.Errorf("the empty ExecStart= must come first, got:\n%s", out)
	}
	if strings.Count(out, "ExecStart=") != 2 {
		t.Errorf("expected exactly one reset and one command, got:\n%s", out)
	}
}

func TestTemplateKeepsAPlaceholderExecStart(t *testing.T) {
	// The template must stay a valid unit on its own, so it keeps a placeholder
	// that each per-site drop-in replaces.
	if !strings.Contains(Template(), "ExecStart=/bin/false") {
		t.Error("template needs a placeholder ExecStart")
	}
}

func TestDropInContainsSiteSettings(t *testing.T) {
	spec := Spec{
		Slug:        "billing-api",
		Tenant:      "tenant_alex",
		Runtime:     "nodejs",
		Version:     "22",
		WorkDir:     "/home/tenant_alex/apps/billing-api",
		EnvFile:     "/home/tenant_alex/apps/billing-api/.env",
		ExecStart:   []string{"npm", "start", "--", "--port", "3000"},
		Port:        3000,
		MemoryMaxMB: 512,
		CPUQuota:    100,
		ExtraEnv:    map[string]string{"NODE_ENV": "production", "APP_NAME": "billing"},
	}

	out := DropIn(spec)
	for _, want := range []string{
		"User=tenant_alex",
		"Group=tenant_alex",
		"WorkingDirectory=/home/tenant_alex/apps/billing-api",
		"EnvironmentFile=/home/tenant_alex/apps/billing-api/.env",
		"Environment=PORT=3000",
		"ExecStart=npm start -- --port 3000",
		"Environment=APP_NAME=billing",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("drop-in is missing %q\n---\n%s", want, out)
		}
	}
	// Resource controls live in their own drop-in now, so the runtime drop-in must not
	// carry them: two files setting the same thing is exactly the disagreement the split
	// removes.
	for _, unwanted := range []string{"MemoryMax=", "CPUQuota=", "CPUWeight="} {
		if strings.Contains(out, unwanted) {
			t.Errorf("runtime drop-in must not set %q\n---\n%s", unwanted, out)
		}
	}
}

func TestResourcesDropInRendersQuotaOrWeight(t *testing.T) {
	// Hardcap: a quota, and no weight.
	hardcap := ResourcesDropIn(Spec{MemoryMaxMB: 512, CPUQuota: 100, TasksMax: 256})
	for _, want := range []string{"MemoryMax=512M", "CPUQuota=100%", "TasksMax=256"} {
		if !strings.Contains(hardcap, want) {
			t.Errorf("hardcap resources.conf is missing %q\n---\n%s", want, hardcap)
		}
	}
	if strings.Contains(hardcap, "CPUWeight=") {
		t.Errorf("hardcap must not set a weight\n---\n%s", hardcap)
	}

	// Sharing: a weight, and no quota.
	shared := ResourcesDropIn(Spec{MemoryMaxMB: 512, CPUWeight: 200, TasksMax: 256})
	if !strings.Contains(shared, "CPUWeight=200") {
		t.Errorf("shared resources.conf is missing the weight\n---\n%s", shared)
	}
	if strings.Contains(shared, "CPUQuota=") {
		t.Errorf("shared must not set a hard quota\n---\n%s", shared)
	}
}

func TestWriteCreatesTemplateAndDropIn(t *testing.T) {
	units := t.TempDir()
	spec := Spec{Slug: "demo", Tenant: "tester", WorkDir: "/home/tester/apps/demo", ExecStart: []string{"/bin/true"}}

	templatePath, dropInPath, err := Write(units, spec)
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	if _, err := os.Stat(templatePath); err != nil {
		t.Fatalf("template not written: %v", err)
	}
	if _, err := os.Stat(dropInPath); err != nil {
		t.Fatalf("drop-in not written: %v", err)
	}
	if filepath.Base(templatePath) != TemplateName {
		t.Errorf("template name = %s, want %s", filepath.Base(templatePath), TemplateName)
	}
	if !strings.Contains(dropInPath, "barepod-app@demo.service.d") {
		t.Errorf("unexpected drop-in path: %s", dropInPath)
	}
	// The resource-controls drop-in is written alongside the runtime one, so a mode switch
	// can rewrite it without rebuilding the runtime content.
	resourcesPath := filepath.Join(DropInDir(units, "demo"), "resources.conf")
	if _, err := os.Stat(resourcesPath); err != nil {
		t.Fatalf("resources drop-in not written: %v", err)
	}

	if err := Remove(units, "demo"); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if _, err := os.Stat(filepath.Dir(dropInPath)); !os.IsNotExist(err) {
		t.Errorf("drop-in directory still exists after Remove")
	}
}

func TestTemplateUsesInstancePlaceholder(t *testing.T) {
	if !strings.Contains(Template(), "barepod-%i") {
		t.Error("template is missing the %i instance placeholder")
	}
}
