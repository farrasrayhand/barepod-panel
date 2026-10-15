package files

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCompressAndExtractZip(t *testing.T) {
	dir := t.TempDir()
	m, err := NewManager(dir, DirectOps{}, 10<<20)
	if err != nil {
		t.Fatal(err)
	}

	// Create test files and nested folders
	if err := os.WriteFile(filepath.Join(dir, "hello.txt"), []byte("hello world"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "sub", "inner.txt"), []byte("inner content"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Compress
	if err := m.Compress([]string{"hello.txt", "sub"}, "myarchive.zip", "zip"); err != nil {
		t.Fatalf("Compress failed: %v", err)
	}

	// Verify zip exists
	if _, err := os.Stat(filepath.Join(dir, "myarchive.zip")); err != nil {
		t.Fatalf("myarchive.zip was not created: %v", err)
	}

	// Extract into "extracted"
	extracted, err := m.Extract("myarchive.zip", "extracted")
	if err != nil {
		t.Fatalf("Extract failed: %v", err)
	}
	if len(extracted) == 0 {
		t.Fatal("No files were extracted")
	}

	// Verify extracted files
	helloExtracted, err := os.ReadFile(filepath.Join(dir, "extracted", "hello.txt"))
	if err != nil || string(helloExtracted) != "hello world" {
		t.Fatalf("Extracted hello.txt mismatch: %s, %v", string(helloExtracted), err)
	}
	innerExtracted, err := os.ReadFile(filepath.Join(dir, "extracted", "sub", "inner.txt"))
	if err != nil || string(innerExtracted) != "inner content" {
		t.Fatalf("Extracted sub/inner.txt mismatch: %s, %v", string(innerExtracted), err)
	}
}

func TestCompressAndExtractTarGz(t *testing.T) {
	dir := t.TempDir()
	m, err := NewManager(dir, DirectOps{}, 10<<20)
	if err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(dir, "data.json"), []byte(`{"status":"ok"}`), 0o644); err != nil {
		t.Fatal(err)
	}

	// Compress
	if err := m.Compress([]string{"data.json"}, "bundle.tar.gz", "tar.gz"); err != nil {
		t.Fatalf("Compress tar.gz failed: %v", err)
	}

	// Extract
	_, err = m.Extract("bundle.tar.gz", "unpacked")
	if err != nil {
		t.Fatalf("Extract tar.gz failed: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(dir, "unpacked", "data.json"))
	if err != nil || string(content) != `{"status":"ok"}` {
		t.Fatalf("Extracted data.json mismatch: %s, %v", string(content), err)
	}
}
