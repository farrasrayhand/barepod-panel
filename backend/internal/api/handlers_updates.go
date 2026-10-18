package api

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// UpdateManifest mirrors the release asset metadata from GitHub / updates server.
type UpdateManifest struct {
	Version           string `json:"version"`
	Tag               string `json:"tag"`
	Channel           string `json:"channel"`
	PublishedAt       string `json:"published_at"`
	ReleaseNotesURL   string `json:"releaseNotesUrl,omitempty"`
	ChangelogMarkdown string `json:"changelogMarkdown,omitempty"`
	Assets            map[string]struct {
		Filename  string `json:"filename"`
		SHA256    string `json:"sha256"`
		SizeBytes int64  `json:"size_bytes"`
	} `json:"assets"`
}

type updateProgress struct {
	Step            string `json:"step"`
	ProgressPercent int    `json:"progressPercent"`
	Message         string `json:"message"`
	Status          string `json:"status,omitempty"`
	NewVersion      string `json:"newVersion,omitempty"`
	Error           string `json:"error,omitempty"`
}

var (
	updateMu         sync.Mutex
	activeUpdateJob  string
	activeUpdateChan chan updateProgress
)

// handleCheckUpdates checks GitHub Releases for latest release information.
func (s *Server) handleCheckUpdates(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/repos/farrasrayhand/barepod-panel/releases/latest", nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "request_creation_failed", err.Error())
		return
	}
	req.Header.Set("User-Agent", "BarePod-Panel/"+Version)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "upstream_unreachable", "Failed to reach GitHub Releases: "+err.Error())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		writeError(w, http.StatusBadGateway, "upstream_error", fmt.Sprintf("GitHub returned HTTP %d", resp.StatusCode))
		return
	}

	var ghRelease struct {
		TagName     string `json:"tag_name"`
		Name        string `json:"name"`
		Body        string `json:"body"`
		PublishedAt string `json:"published_at"`
		HTMLURL     string `json:"html_url"`
		Assets      []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
			Size               int64  `json:"size"`
		} `json:"assets"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&ghRelease); err != nil {
		writeError(w, http.StatusInternalServerError, "decode_failed", err.Error())
		return
	}

	latestVersion := strings.TrimPrefix(ghRelease.TagName, "v")
	currentVerClean := strings.TrimPrefix(strings.Split(Version, "-")[0], "v")
	hasUpdate := isNewerVersion(latestVersion, currentVerClean)

	var manifestURL string
	for _, a := range ghRelease.Assets {
		if a.Name == "manifest.json" {
			manifestURL = a.BrowserDownloadURL
			break
		}
	}

	var manifest UpdateManifest
	if manifestURL != "" {
		mReq, _ := http.NewRequestWithContext(ctx, http.MethodGet, manifestURL, nil)
		mReq.Header.Set("User-Agent", "BarePod-Panel/"+Version)
		if mResp, err := client.Do(mReq); err == nil && mResp.StatusCode == http.StatusOK {
			_ = json.NewDecoder(mResp.Body).Decode(&manifest)
			mResp.Body.Close()
		}
	}

	archKey := "linux-" + runtime.GOARCH
	remoteSHA := manifest.Assets[archKey].SHA256
	var currentBinarySHA string
	if f, err := os.Open("/usr/local/bin/barepod"); err == nil {
		h := sha256.New()
		if _, err := io.Copy(h, f); err == nil {
			currentBinarySHA = hex.EncodeToString(h.Sum(nil))
		}
		f.Close()
	}

	isPatchBuild := false

	// Clean up duplicate changelog lines if GitHub release notes contain repeats
	lines := strings.Split(ghRelease.Body, "\n")
	seen := make(map[string]bool)
	var cleanLines []string
	for _, l := range lines {
		trimmed := strings.TrimSpace(l)
		if trimmed != "" && seen[trimmed] {
			continue
		}
		if trimmed != "" {
			seen[trimmed] = true
		}
		cleanLines = append(cleanLines, l)
	}
	cleanChangelog := strings.TrimSpace(strings.Join(cleanLines, "\n"))

	writeJSON(w, http.StatusOK, map[string]any{
		"currentVersion":   currentVerClean,
		"rawVersion":       Version,
		"latestVersion":    latestVersion,
		"hasUpdate":        hasUpdate,
		"isPatchBuild":     isPatchBuild,
		"currentBinarySha": currentBinarySHA,
		"remoteBinarySha":  remoteSHA,
		"release": map[string]any{
			"tag":               ghRelease.TagName,
			"version":           latestVersion,
			"publishedAt":       ghRelease.PublishedAt,
			"releaseNotesUrl":   ghRelease.HTMLURL,
			"changelogMarkdown": cleanChangelog,
			"asset": map[string]any{
				"arch":      archKey,
				"sha256":    manifest.Assets[archKey].SHA256,
				"sizeBytes": manifest.Assets[archKey].SizeBytes,
				"filename":  manifest.Assets[archKey].Filename,
			},
		},
	})
}

// handleApplyUpdate initiates the download, smoke test, atomic swap, and supervisor reload.
func (s *Server) handleApplyUpdate(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	updateMu.Lock()
	if activeUpdateJob != "" {
		updateMu.Unlock()
		writeError(w, http.StatusConflict, "update_in_progress", "An update job is already executing.")
		return
	}

	jobID := fmt.Sprintf("upd_%d", time.Now().UnixNano())
	activeUpdateJob = jobID
	activeUpdateChan = make(chan updateProgress, 64)
	updateMu.Unlock()

	var reqBody struct {
		TargetVersion string `json:"targetVersion"`
		Channel       string `json:"channel"`
	}
	_ = json.NewDecoder(r.Body).Decode(&reqBody)

	go s.runUpdatePipeline(jobID, reqBody.TargetVersion, user.Username)

	writeJSON(w, http.StatusAccepted, map[string]any{
		"jobId":     jobID,
		"status":    "in_progress",
		"streamUrl": fmt.Sprintf("/api/v1/system/updates/stream?jobId=%s", jobID),
	})
}

func (s *Server) runUpdatePipeline(jobID, targetVersion, operator string) {
	defer func() {
		updateMu.Lock()
		activeUpdateJob = ""
		if activeUpdateChan != nil {
			close(activeUpdateChan)
			activeUpdateChan = nil
		}
		updateMu.Unlock()
	}()

	sendProgress := func(step string, pct int, msg string) {
		updateMu.Lock()
		ch := activeUpdateChan
		updateMu.Unlock()
		if ch != nil {
			select {
			case ch <- updateProgress{Step: step, ProgressPercent: pct, Message: msg}:
			default:
			}
		}
	}

	sendError := func(step, errMsg string) {
		updateMu.Lock()
		ch := activeUpdateChan
		updateMu.Unlock()
		if ch != nil {
			select {
			case ch <- updateProgress{Step: step, ProgressPercent: 100, Message: errMsg, Status: "failed", Error: errMsg}:
			default:
			}
		}
		_ = s.store.Audit("", "system.update_failed", "system", "127.0.0.1", fmt.Sprintf("Failed at %s: %s", step, errMsg))
	}

	sendProgress("fetch_manifest", 10, "Fetching release manifest from GitHub...")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get("https://api.github.com/repos/farrasrayhand/barepod-panel/releases/latest")
	if err != nil {
		sendError("fetch_manifest", "Could not reach GitHub Releases: "+err.Error())
		return
	}
	defer resp.Body.Close()

	var ghRelease struct {
		TagName string `json:"tag_name"`
		Assets  []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
			Size               int64  `json:"size"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&ghRelease); err != nil {
		sendError("fetch_manifest", "Invalid release metadata: "+err.Error())
		return
	}

	tag := ghRelease.TagName
	arch := runtime.GOARCH
	expectedTarball := fmt.Sprintf("barepod-%s-linux-%s.tar.gz", tag, arch)

	var downloadURL, manifestURL, shaSumsURL string
	for _, a := range ghRelease.Assets {
		if a.Name == expectedTarball {
			downloadURL = a.BrowserDownloadURL
		} else if a.Name == "manifest.json" {
			manifestURL = a.BrowserDownloadURL
		} else if a.Name == "SHA256SUMS" {
			shaSumsURL = a.BrowserDownloadURL
		}
	}

	if downloadURL == "" {
		sendError("discovery", fmt.Sprintf("No precompiled bundle found for linux/%s in %s", arch, tag))
		return
	}

	var expectedSHA, sumsContent string
	if shaSumsURL != "" {
		sReq, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, shaSumsURL, nil)
		sReq.Header.Set("Cache-Control", "no-cache")
		sReq.Header.Set("Pragma", "no-cache")
		if sResp, err := client.Do(sReq); err == nil && sResp.StatusCode == http.StatusOK {
			data, _ := io.ReadAll(sResp.Body)
			sumsContent = string(data)
			sResp.Body.Close()
		}
	}
	if manifestURL != "" {
		mReq, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, manifestURL, nil)
		mReq.Header.Set("Cache-Control", "no-cache")
		mReq.Header.Set("Pragma", "no-cache")
		if mResp, err := client.Do(mReq); err == nil && mResp.StatusCode == http.StatusOK {
			var manifest UpdateManifest
			if err := json.NewDecoder(mResp.Body).Decode(&manifest); err == nil {
				expectedSHA = manifest.Assets["linux-"+arch].SHA256
			}
			mResp.Body.Close()
		}
	}

	updatesDir := "/var/lib/barepod/updates"
	_ = os.MkdirAll(updatesDir, 0700)
	// A staged download is only needed until the swap. Anything still here is from an earlier update
	// (or one that failed before the swap) and is ~9 MB a time, so it is cleared before this run
	// stages its own.
	pruneUpdateStaging(updatesDir)
	destTarball := filepath.Join(updatesDir, expectedTarball)

	sendProgress("download", 30, fmt.Sprintf("Downloading %s...", expectedTarball))
	outTar, err := os.Create(destTarball)
	if err != nil {
		sendError("download", "Cannot create staging file: "+err.Error())
		return
	}

	dlResp, err := client.Get(downloadURL)
	if err != nil {
		outTar.Close()
		sendError("download", "Download failed: "+err.Error())
		return
	}
	defer dlResp.Body.Close()

	if _, err := io.Copy(outTar, dlResp.Body); err != nil {
		outTar.Close()
		sendError("download", "Failed writing archive: "+err.Error())
		return
	}
	outTar.Close()

	if expectedSHA != "" || sumsContent != "" {
		sendProgress("verify", 50, "Verifying SHA-256 checksum against manifest...")
		hasher := sha256.New()
		f, _ := os.Open(destTarball)
		_, _ = io.Copy(hasher, f)
		f.Close()
		computed := hex.EncodeToString(hasher.Sum(nil))

		matched := false
		if expectedSHA != "" && strings.EqualFold(computed, expectedSHA) {
			matched = true
		} else if sumsContent != "" && strings.Contains(strings.ToLower(sumsContent), strings.ToLower(computed)) {
			matched = true
		}

		if !matched {
			sendError("verify", fmt.Sprintf("Checksum mismatch! computed=%s, expected=%s", computed, expectedSHA))
			return
		}
	}

	sendProgress("extract", 65, "Extracting binary and web assets...")
	stagingExtract := filepath.Join(updatesDir, "staging_"+jobID)
	_ = os.RemoveAll(stagingExtract)
	_ = os.MkdirAll(stagingExtract, 0700)

	if err := extractTarGz(destTarball, stagingExtract); err != nil {
		sendError("extract", "Archive extraction failed: "+err.Error())
		return
	}

	newBinary := filepath.Join(stagingExtract, "barepod")
	if _, err := os.Stat(newBinary); err != nil {
		sendError("extract", "Archive does not contain 'barepod' executable")
		return
	}
	_ = os.Chmod(newBinary, 0755)

	sendProgress("smoke_test", 75, "Running pre-flight smoke test on new binary...")
	smokeCmd := exec.Command(newBinary, "version")
	smokeOut, err := smokeCmd.CombinedOutput()
	if err != nil {
		sendError("smoke_test", fmt.Sprintf("Binary test failed (%v): %s", err, string(smokeOut)))
		return
	}

	sendProgress("backup", 85, "Backing up active binary and frontend...")
	currentBinary := "/usr/local/bin/barepod"
	if _, err := os.Stat(currentBinary); err == nil {
		_ = copyFile(currentBinary, currentBinary+".bak")
	}

	activeDist := "/var/lib/barepod/dist"
	if _, err := os.Stat(activeDist); err == nil {
		_ = os.RemoveAll(activeDist + ".bak")
		_ = copyDir(activeDist, activeDist+".bak")
	}

	sendProgress("swap", 92, "Atomically swapping binary and web assets...")
	if err := os.Rename(newBinary, currentBinary); err != nil {
		// Fallback to copy + unlink
		if err := copyFile(newBinary, currentBinary); err != nil {
			sendError("swap", "Failed atomic swap: "+err.Error())
			return
		}
	}
	_ = os.Chmod(currentBinary, 0755)

	newDist := filepath.Join(stagingExtract, "dist")
	if _, err := os.Stat(newDist); err == nil {
		_ = os.RemoveAll(activeDist)
		_ = os.Rename(newDist, activeDist)
	}

	_ = os.RemoveAll(stagingExtract)
	// The archive has been extracted, verified and swapped in; keeping it would be the only thing
	// this pipeline leaves behind.
	_ = os.Remove(destTarball)

	sendProgress("restarting", 98, "Triggering daemon restart via supervisor...")

	updateMu.Lock()
	ch := activeUpdateChan
	updateMu.Unlock()
	if ch != nil {
		select {
		case ch <- updateProgress{
			Step:            "complete",
			ProgressPercent: 100,
			Message:         "Update successfully applied. Restarting service...",
			Status:          "success",
			NewVersion:      tag,
		}:
		default:
		}
	}

	_ = s.store.Audit("", "system.update_applied", "system", "127.0.0.1", fmt.Sprintf("Panel successfully updated to %s (job %s)", tag, jobID))

	go func() {
		time.Sleep(1 * time.Second)
		_ = exec.Command("systemctl", "restart", "barepod.service").Run()
	}()
}

// handleUpdateStream serves Server-Sent Events (SSE) for tracking update jobs.
func (s *Server) handleUpdateStream(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	updateMu.Lock()
	ch := activeUpdateChan
	updateMu.Unlock()

	if ch == nil {
		data, _ := json.Marshal(map[string]any{"status": "idle", "message": "No active update in progress."})
		fmt.Fprintf(w, "event: done\ndata: %s\n\n", data)
		flusher.Flush()
		return
	}

	for {
		select {
		case <-r.Context().Done():
			return
		case prog, ok := <-ch:
			if !ok {
				fmt.Fprintf(w, "event: done\ndata: {\"status\":\"closed\"}\n\n")
				flusher.Flush()
				return
			}
			data, _ := json.Marshal(prog)
			if prog.Status == "success" || prog.Status == "failed" {
				fmt.Fprintf(w, "event: done\ndata: %s\n\n", data)
				flusher.Flush()
				return
			}
			fmt.Fprintf(w, "event: step\ndata: %s\n\n", data)
			flusher.Flush()
		}
	}
}

// pruneUpdateStaging removes release archives staged by an earlier update. An archive is only needed
// between the download and the swap; keeping them would grow /var/lib/barepod/updates by one ~9 MB
// tarball per update, for ever.
func pruneUpdateStaging(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".tar.gz") {
			continue
		}
		_ = os.Remove(filepath.Join(dir, entry.Name()))
	}
}

func extractTarGz(srcTarGz, destDir string) error {
	f, err := os.Open(srcTarGz)
	if err != nil {
		return err
	}
	defer f.Close()

	gzr, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gzr.Close()

	tr := tar.NewReader(gzr)
	for {
		header, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}

		cleanPath := filepath.Clean(header.Name)
		if strings.HasPrefix(cleanPath, "..") {
			continue
		}
		target := filepath.Join(destDir, cleanPath)

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				return err
			}
			outFile, err := os.OpenFile(target, os.O_CREATE|os.O_RDWR|os.O_TRUNC, os.FileMode(header.Mode))
			if err != nil {
				return err
			}
			if _, err := io.Copy(outFile, tr); err != nil {
				outFile.Close()
				return err
			}
			outFile.Close()
		}
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}

func copyDir(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		return copyFile(path, target)
	})
}

// isNewerVersion reports whether remote represents a higher semantic version than current.
func isNewerVersion(remote, current string) bool {
	if remote == "" || current == "" || remote == current {
		return false
	}
	rParts := strings.Split(strings.TrimPrefix(remote, "v"), ".")
	cParts := strings.Split(strings.TrimPrefix(current, "v"), ".")
	maxLen := len(rParts)
	if len(cParts) > maxLen {
		maxLen = len(cParts)
	}
	for i := 0; i < maxLen; i++ {
		rNum, cNum := 0, 0
		if i < len(rParts) {
			rNum, _ = strconv.Atoi(strings.Split(rParts[i], "-")[0])
		}
		if i < len(cParts) {
			cNum, _ = strconv.Atoi(strings.Split(cParts[i], "-")[0])
		}
		if rNum > cNum {
			return true
		}
		if rNum < cNum {
			return false
		}
	}
	return false
}
