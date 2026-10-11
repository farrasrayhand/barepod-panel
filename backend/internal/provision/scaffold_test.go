package provision

import (
	"strings"
	"testing"
)

func TestStarterFilesExistForFrameworksThatNeedAnEntrypoint(t *testing.T) {
	flask := StarterFiles("flask", 8000)
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

	fastapi := StarterFiles("fastapi", 8000)
	if !strings.Contains(fastapi["app.py"], "FastAPI") {
		t.Errorf("fastapi starter = %q", fastapi["app.py"])
	}
}

func TestNoStarterFilesForBringYourOwnCode(t *testing.T) {
	for _, framework := range []string{"", "generic", "laravel", "nextjs"} {
		if files := StarterFiles(framework, 8000); len(files) != 0 {
			t.Errorf("StarterFiles(%q) = %v, want none (the download provides the app)", framework, files)
		}
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
