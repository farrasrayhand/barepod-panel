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

// EnsurePhpExtensions verifies that php-cli and necessary extensions (mysqli, mbstring, etc.)
// are installed and enabled in PHP CLI. If mysqli or mbstring is missing, it installs them
// and ensures they are enabled.
func EnsurePhpExtensions() {
	needsInstall := false
	if _, err := exec.LookPath("php"); err != nil {
		needsInstall = true
	} else {
		out, err := exec.Command("php", "-m").CombinedOutput()
		if err != nil || !strings.Contains(string(out), "mysqli") || !strings.Contains(string(out), "mbstring") {
			needsInstall = true
		}
	}

	if !needsInstall {
		return
	}

	script := `
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq || true
apt-get install -y -qq php-cli php-mysql php-mbstring php-zip php-gd php-curl php-xml || true
if command -v php >/dev/null 2>&1; then
    PHP_VER=$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;' 2>/dev/null || true)
    if [ -n "$PHP_VER" ]; then
        apt-get install -y -qq "php${PHP_VER}-mysql" "php${PHP_VER}-mbstring" "php${PHP_VER}-zip" "php${PHP_VER}-gd" "php${PHP_VER}-curl" "php${PHP_VER}-xml" || true
        phpenmod -v "${PHP_VER}" mysqli mbstring zip gd curl xml 2>/dev/null || true
    fi
fi
phpenmod -v ALL mysqli mbstring zip gd curl xml 2>/dev/null || true

for conf_dir in /etc/php/*/cli/conf.d; do
    if [ -d "$conf_dir" ]; then
        if [ ! -f "$conf_dir/20-mysqli.ini" ] && [ ! -L "$conf_dir/20-mysqli.ini" ]; then
            echo "extension=mysqli" > "$conf_dir/20-mysqli.ini" 2>/dev/null || true
        fi
        if [ ! -f "$conf_dir/20-mbstring.ini" ] && [ ! -L "$conf_dir/20-mbstring.ini" ]; then
            echo "extension=mbstring" > "$conf_dir/20-mbstring.ini" 2>/dev/null || true
        fi
    fi
done

pkill -f "php -S 127.0.0.1:8791" || true
`
	cmd := exec.Command("sh", "-c", script)
	_ = cmd.Run()
}

// EnsurePhpMyAdmin checks if phpMyAdmin is installed in dbtoolsDir/phpmyadmin/index.php.
// If not installed, it downloads and extracts the official phpMyAdmin archive automatically,
// and ensures php-cli and required extensions (mysqli, mbstring, etc.) are installed and active.
func EnsurePhpMyAdmin(dbtoolsDir string) error {
	installMu.Lock()
	defer installMu.Unlock()

	pmaDir := filepath.Join(dbtoolsDir, "phpmyadmin")
	indexPath := filepath.Join(pmaDir, "index.php")

	EnsurePhpExtensions()

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

