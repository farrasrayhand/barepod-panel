package provision

import (
	"strings"
	"testing"
)

func TestStarterFilesExistForFrameworksThatNeedAnEntrypoint(t *testing.T) {
	flask := StarterFiles("python", "flask", 8000)
	if len(flask) == 0 {
		t.Fatal("flask needs a starter app, otherwise gunicorn app:app fails")
	}
	app, ok := flask["app.py"]
	if !ok {
		t.Fatalf("flask starter files = %v, want app.py", flask)
	}
	for _, want := range []string{"app = Flask", "/healthz", "port=8000"} {
		if !strings.Contains(app, want) {
			t.Errorf("flask starter is missing %q", want)
		}
	}

	fastapi := StarterFiles("python", "fastapi", 8000)
	if !strings.Contains(fastapi["app.py"], "FastAPI") {
		t.Errorf("fastapi starter = %q", fastapi["app.py"])
	}
}

func TestNoStarterFilesForBringYourOwnCode(t *testing.T) {
	for _, framework := range []string{"", "generic", "laravel", "nextjs"} {
		if files := StarterFiles("static", framework, 8000); len(files) != 0 {
			t.Errorf("StarterFiles(%q) = %v, want none (the download provides the app)", framework, files)
		}
	}
}

func TestPhpStarterAnswersOnlyForAPlainPhpSite(t *testing.T) {
	files := StarterFiles("php", "generic php", 8001)
	if _, ok := files["index.php"]; !ok {
		t.Fatalf("a plain PHP site needs an index.php, got %v", files)
	}
	// A framework preset brings its own entrypoint; nothing is invented for it.
	if files := StarterFiles("php", "laravel", 8001); len(files) != 0 {
		t.Errorf("StarterFiles(php, laravel) = %v, want none", files)
	}
}

func TestPythonExecStartUsesAnASGIWorkerForFastAPI(t *testing.T) {
	gunicorn := ExecStart("python", "3.12", "flask", "/srv/app", 8000)
	joined := strings.Join(gunicorn, " ")
	if !strings.Contains(joined, "/.venv/bin/gunicorn") || !strings.Contains(joined, "app:app") {
		t.Fatalf("flask exec = %q", joined)
	}
	if strings.Contains(joined, "UvicornWorker") {
		t.Errorf("flask should use the default worker: %q", joined)
	}

	fastapi := strings.Join(ExecStart("python", "3.12", "fastapi", "/srv/app", 8000), " ")
	if !strings.Contains(fastapi, "uvicorn.workers.UvicornWorker") {
		t.Errorf("fastapi exec must use an ASGI worker: %q", fastapi)
	}
}

// Debian and Ubuntu name the binary after the version as written — php-fpm8.3 — so the path the
// panel builds must keep the dot. Stripping it produced php-fpm83, which exists nowhere, so a PHP
// website's unit could never have started (measured on the test host).
func TestPhpFpmPathKeepsTheDottedVersion(t *testing.T) {
	argv := ExecStart("php", "8.3", "", "/srv/site", 9000)
	if len(argv) == 0 || argv[0] != "/usr/sbin/php-fpm8.3" {
		t.Fatalf("php-fpm path = %v, want /usr/sbin/php-fpm8.3", argv)
	}
	if got := ExecStart("php", "", "", "/srv/site", 9000); len(got) == 0 || got[0] != "/usr/sbin/php-fpm" {
		t.Errorf("unversioned php-fpm path = %v, want the distribution's default binary", got)
	}
}
