package dbtools

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

var installMu sync.Mutex

const pmaVersion = "5.2.1"
const pgwebVersion = "0.16.2"

// EnsurePhpMyAdmin checks if phpMyAdmin is installed in dbtoolsDir/phpmyadmin/index.php.
// If not installed, it downloads and extracts the official phpMyAdmin archive automatically,
// and ensures php-cli and required extensions are installed.
func EnsurePhpMyAdmin(dbtoolsDir string) error {
	installMu.Lock()
	defer installMu.Unlock()

	pmaDir := filepath.Join(dbtoolsDir, "phpmyadmin")
	indexPath := filepath.Join(pmaDir, "index.php")

	// Ensure php-cli and required extensions are present
	if _, err := exec.LookPath("php"); err != nil {
		cmd := exec.Command("sh", "-c", "DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq php-cli php-mysql php-mbstring php-zip php-gd php-curl php-xml")
		_ = cmd.Run()
	}

	if _, err := os.Stat(indexPath); err == nil {
		return nil
	}

	_ = os.MkdirAll(dbtoolsDir, 0755)

	url := fmt.Sprintf("https://files.phpmyadmin.net/phpMyAdmin/%s/phpMyAdmin-%s-english.tar.gz", pmaVersion, pmaVersion)
	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return fmt.Errorf("download phpmyadmin: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download phpmyadmin failed with HTTP %d", resp.StatusCode)
	}

	gzr, err := gzip.NewReader(resp.Body)
	if err != nil {
		return err
	}
	defer gzr.Close()

	tr := tar.NewReader(gzr)
	prefix := fmt.Sprintf("phpMyAdmin-%s-english", pmaVersion)

	tmpDir, err := os.MkdirTemp(dbtoolsDir, "pma_tmp_*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		clean := filepath.Clean(header.Name)
		if strings.HasPrefix(clean, "..") {
			continue
		}
		rel := strings.TrimPrefix(clean, prefix)
		rel = strings.TrimPrefix(rel, "/")
		if rel == "" {
			continue
		}

		target := filepath.Join(tmpDir, rel)
		switch header.Typeflag {
		case tar.TypeDir:
			_ = os.MkdirAll(target, 0755)
		case tar.TypeReg:
			_ = os.MkdirAll(filepath.Dir(target), 0755)
			outFile, err := os.OpenFile(target, os.O_CREATE|os.O_RDWR|os.O_TRUNC, header.FileInfo().Mode())
			if err != nil {
				continue
			}
			_, _ = io.Copy(outFile, tr)
			outFile.Close()
		}
	}

	_ = os.RemoveAll(pmaDir)
	if err := os.Rename(tmpDir, pmaDir); err != nil {
		return err
	}
	_ = os.Chmod(pmaDir, 0755)
	return nil
}

// EnsurePgweb checks if pgweb binary exists in /usr/local/bin/pgweb.
// If missing, it downloads the precompiled binary from GitHub and extracts it using archive/zip.
func EnsurePgweb() error {
	installMu.Lock()
	defer installMu.Unlock()

	targetBin := "/usr/local/bin/pgweb"
	if _, err := os.Stat(targetBin); err == nil {
		return nil
	}

	arch := runtime.GOARCH
	if arch != "amd64" && arch != "arm64" {
		return fmt.Errorf("unsupported arch %s for pgweb", arch)
	}

	url := fmt.Sprintf("https://github.com/sosedoff/pgweb/releases/download/v%s/pgweb_linux_%s.zip", pgwebVersion, arch)
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return fmt.Errorf("download pgweb: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download pgweb HTTP %d", resp.StatusCode)
	}

	tmpZip, err := os.CreateTemp("", "pgweb_*.zip")
	if err != nil {
		return err
	}
	defer os.Remove(tmpZip.Name())
	defer tmpZip.Close()

	if _, err := io.Copy(tmpZip, resp.Body); err != nil {
		return err
	}
	_ = tmpZip.Close()

	zr, err := zip.OpenReader(tmpZip.Name())
	if err != nil {
		return fmt.Errorf("read pgweb zip: %w", err)
	}
	defer zr.Close()

	found := false
	for _, f := range zr.File {
		if strings.HasPrefix(f.Name, "pgweb") && !f.FileInfo().IsDir() {
			rc, err := f.Open()
			if err != nil {
				return err
			}
			outF, err := os.OpenFile(targetBin, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
			if err != nil {
				rc.Close()
				return err
			}
			_, _ = io.Copy(outF, rc)
			rc.Close()
			outF.Close()
			_ = os.Chmod(targetBin, 0755)
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("pgweb binary not found in downloaded zip")
	}
	return nil
}

