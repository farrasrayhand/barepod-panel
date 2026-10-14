package framework

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestDetectLaravel(t *testing.T) {
	dir := t.TempDir()
	composer := `{
		"require": {
			"php": "^8.2",
			"laravel/framework": "^11.0"
		}
	}`
	if err := os.WriteFile(filepath.Join(dir, "composer.json"), []byte(composer), 0o644); err != nil {
		t.Fatal(err)
	}

	fw := Detect(dir)
	if fw == nil {
		t.Fatal("expected detected framework, got nil")
	}
	if fw.Name != "laravel" {
		t.Errorf("got name %q, want laravel", fw.Name)
	}
	if fw.Runtime != "php" {
		t.Errorf("got runtime %q, want php", fw.Runtime)
	}
	if fw.Version != "8.2" {
		t.Errorf("got version %q, want 8.2", fw.Version)
	}
	if fw.DocRoot != "public" {
		t.Errorf("got docRoot %q, want public", fw.DocRoot)
	}
	if fw.DatabaseEngine != "mariadb" {
		t.Errorf("got db %q, want mariadb", fw.DatabaseEngine)
	}
}

func TestDetectNextjs(t *testing.T) {
	dir := t.TempDir()
	pkg := `{
		"dependencies": {
			"next": "^15.0.0",
			"react": "^19.0.0"
		},
		"scripts": {
			"build": "next build",
			"start": "next start"
		}
	}`
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(pkg), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "pnpm-lock.yaml"), []byte("lockfileversion: 9"), 0o644); err != nil {
		t.Fatal(err)
	}

	fw := Detect(dir)
	if fw == nil {
		t.Fatal("expected detected framework, got nil")
	}
	if fw.Name != "nextjs" {
		t.Errorf("got name %q, want nextjs", fw.Name)
	}
	if fw.PackageManager != "pnpm" {
		t.Errorf("got pm %q, want pnpm", fw.PackageManager)
	}
	if !fw.IsProxy {
		t.Errorf("expected isProxy true")
	}
	if fw.Port != 3000 {
		t.Errorf("got port %d, want 3000", fw.Port)
	}
}

func TestDetectViteSPA(t *testing.T) {
	dir := t.TempDir()
	pkg := `{
		"devDependencies": {
			"vite": "^6.0.0",
			"@vitejs/plugin-react": "^4.0.0"
		},
		"scripts": {
			"build": "vite build"
		}
	}`
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(pkg), 0o644); err != nil {
		t.Fatal(err)
	}

	fw := Detect(dir)
	if fw == nil {
		t.Fatal("expected detected framework, got nil")
	}
	if fw.Name != "vite" {
		t.Errorf("got name %q, want vite", fw.Name)
	}
	if fw.Runtime != "static" {
		t.Errorf("got runtime %q, want static", fw.Runtime)
	}
	if fw.DocRoot != "dist" {
		t.Errorf("got docRoot %q, want dist", fw.DocRoot)
	}
}

func TestDetectArchive(t *testing.T) {
	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)

	f, err := zw.Create("composer.json")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = f.Write([]byte(`{"require":{"php":"^8.3","laravel/framework":"^11.0"}}`))
	_ = zw.Close()

	reader := bytes.NewReader(buf.Bytes())
	fw := DetectArchive(reader, int64(buf.Len()))
	if fw == nil {
		t.Fatal("expected framework from zip, got nil")
	}
	if fw.Name != "laravel" {
		t.Errorf("got %q, want laravel", fw.Name)
	}
	if fw.Version != "8.3" {
		t.Errorf("got %q, want 8.3", fw.Version)
	}
}
