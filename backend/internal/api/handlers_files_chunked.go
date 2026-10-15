package api

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

var validUploadID = regexp.MustCompile(`^[a-zA-Z0-9_\-]+$`)

type extractRequest struct {
	Path        string `json:"path"`
	Destination string `json:"destination,omitempty"`
}

// handleExtractFiles unpacks an archive (.zip, .tar.gz, etc.) into the specified destination folder.
func (s *Server) handleExtractFiles(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	manager, site, ok := s.fileManagerFor(w, r, user)
	if !ok {
		return
	}
	var req extractRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	if strings.TrimSpace(req.Path) == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "An archive path is required")
		return
	}

	dest := strings.TrimSpace(req.Destination)
	if dest == "" || dest == "." {
		dest = path.Dir(strings.TrimPrefix(req.Path, "/"))
	}

	extracted, err := manager.Extract(req.Path, dest)
	if err != nil {
		writeFileError(w, err)
		return
	}

	_ = s.store.Audit(user.ID, "files.extract", site.Slug+"/"+strings.TrimPrefix(req.Path, "/"), clientIP(r),
		fmt.Sprintf("extracted %d items to %s", len(extracted), dest))

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"destination": strings.TrimPrefix(dest, "/"),
		"extracted":   extracted,
	})
}

// handleScopedExtract unpacks an archive in host-scoped files.
func (s *Server) handleScopedExtract(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	scope, ok := s.scopedFilesFor(w, r, user)
	if !ok {
		return
	}
	var req extractRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	if strings.TrimSpace(req.Path) == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "An archive path is required")
		return
	}

	dest := strings.TrimSpace(req.Destination)
	if dest == "" || dest == "." {
		dest = path.Dir(strings.TrimPrefix(req.Path, "/"))
	}

	extracted, err := scope.manager.Extract(req.Path, dest)
	if err != nil {
		s.block(w, r, user, scope, req.Path, err)
		return
	}

	_ = s.store.Audit(user.ID, "files.extract", scope.auditTarget(req.Path), clientIP(r),
		fmt.Sprintf("extracted %d items to %s", len(extracted), dest))

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"destination": strings.TrimPrefix(dest, "/"),
		"extracted":   extracted,
	})
}

// handleUploadChunk handles chunked, resumable file uploads.
func (s *Server) handleUploadChunk(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	manager, site, ok := s.fileManagerFor(w, r, user)
	if !ok {
		return
	}

	uploadID := r.FormValue("uploadId")
	if !validUploadID.MatchString(uploadID) {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid upload ID")
		return
	}

	chunkIdxStr := r.FormValue("chunkIndex")
	totalChunksStr := r.FormValue("totalChunks")
	filename := r.FormValue("filename")
	targetDir := r.FormValue("path")
	autoExtract := r.FormValue("autoExtract") == "true" || r.URL.Query().Get("autoExtract") == "true"

	chunkIndex, err1 := strconv.Atoi(chunkIdxStr)
	totalChunks, err2 := strconv.Atoi(totalChunksStr)
	if err1 != nil || err2 != nil || chunkIndex < 0 || totalChunks <= 0 || chunkIndex >= totalChunks {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid chunkIndex or totalChunks")
		return
	}

	cleanRel := filepath.Clean(filepath.ToSlash(filename))
	if strings.HasPrefix(cleanRel, "../") || cleanRel == ".." || filepath.IsAbs(cleanRel) {
		cleanRel = path.Base(cleanRel)
	}
	cleanRel = strings.TrimPrefix(cleanRel, "/")
	if cleanRel == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "Filename is required")
		return
	}

	filePart, _, err := r.FormFile("chunk")
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Missing chunk file part")
		return
	}
	defer filePart.Close()

	chunkData, err := io.ReadAll(io.LimitReader(filePart, 32<<20)) // 32MB max per chunk
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Could not read chunk data")
		return
	}

	tempDir := filepath.Join(os.TempDir(), "barepod-uploads", uploadID)
	if err := os.MkdirAll(tempDir, 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Failed to prepare upload workspace")
		return
	}

	chunkFilePath := filepath.Join(tempDir, fmt.Sprintf("chunk_%05d", chunkIndex))
	if err := os.WriteFile(chunkFilePath, chunkData, 0o644); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Failed to store upload chunk")
		return
	}

	// Check if all chunks are now present
	allPresent := true
	for i := 0; i < totalChunks; i++ {
		p := filepath.Join(tempDir, fmt.Sprintf("chunk_%05d", i))
		if _, err := os.Stat(p); err != nil {
			allPresent = false
			break
		}
	}

	if !allPresent {
		writeJSON(w, http.StatusOK, map[string]any{
			"uploadId":    uploadID,
			"chunkIndex":  chunkIndex,
			"totalChunks": totalChunks,
			"completed":   false,
		})
		return
	}

	// All chunks received! Assemble final payload
	var assembled bytes.Buffer
	for i := 0; i < totalChunks; i++ {
		p := filepath.Join(tempDir, fmt.Sprintf("chunk_%05d", i))
		data, err := os.ReadFile(p)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Failed to assemble chunks")
			return
		}
		assembled.Write(data)
	}

	// Enforce disk quota
	if !s.enforceDiskQuota(w, r, site.TenantUser, int64(assembled.Len())) {
		_ = os.RemoveAll(tempDir)
		return
	}

	target := path.Join(strings.TrimPrefix(targetDir, "/"), cleanRel)
	if parent := path.Dir(target); parent != "." && parent != "" {
		_ = manager.Mkdir(parent)
	}

	if _, err := manager.Write(target, assembled.Bytes()); err != nil {
		_ = os.RemoveAll(tempDir)
		writeFileError(w, err)
		return
	}
	_ = os.RemoveAll(tempDir)

	var extracted []string
	if autoExtract {
		lower := strings.ToLower(target)
		if strings.HasSuffix(lower, ".zip") || strings.HasSuffix(lower, ".tar.gz") || strings.HasSuffix(lower, ".tgz") || strings.HasSuffix(lower, ".tar") {
			destFolder := path.Dir(target)
			if ex, err := manager.Extract(target, destFolder); err == nil {
				extracted = ex
			}
		}
	}

	_ = s.store.Audit(user.ID, "files.upload_resumable", site.Slug, clientIP(r), target)
	writeJSON(w, http.StatusCreated, map[string]any{
		"uploadId":  uploadID,
		"completed": true,
		"path":      target,
		"size":      assembled.Len(),
		"extracted": extracted,
	})
}

// handleUploadChunkStatus reports which chunks have been received for resumable uploads.
func (s *Server) handleUploadChunkStatus(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	_, _, ok := s.fileManagerFor(w, r, user)
	if !ok {
		return
	}
	uploadID := r.URL.Query().Get("uploadId")
	if !validUploadID.MatchString(uploadID) {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid upload ID")
		return
	}

	tempDir := filepath.Join(os.TempDir(), "barepod-uploads", uploadID)
	entries, err := os.ReadDir(tempDir)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"uploadId": uploadID,
			"chunks":   []int{},
		})
		return
	}

	var chunks []int
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "chunk_") {
			idx, err := strconv.Atoi(strings.TrimPrefix(e.Name(), "chunk_"))
			if err == nil {
				chunks = append(chunks, idx)
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"uploadId": uploadID,
		"chunks":   chunks,
	})
}

// handleScopedUploadChunk handles chunked, resumable file uploads for scoped files.
func (s *Server) handleScopedUploadChunk(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	scope, ok := s.scopedFilesFor(w, r, user)
	if !ok {
		return
	}

	uploadID := r.FormValue("uploadId")
	if !validUploadID.MatchString(uploadID) {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid upload ID")
		return
	}

	chunkIdxStr := r.FormValue("chunkIndex")
	totalChunksStr := r.FormValue("totalChunks")
	filename := r.FormValue("filename")
	targetDir := r.FormValue("path")
	autoExtract := r.FormValue("autoExtract") == "true" || r.URL.Query().Get("autoExtract") == "true"

	chunkIndex, err1 := strconv.Atoi(chunkIdxStr)
	totalChunks, err2 := strconv.Atoi(totalChunksStr)
	if err1 != nil || err2 != nil || chunkIndex < 0 || totalChunks <= 0 || chunkIndex >= totalChunks {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid chunkIndex or totalChunks")
		return
	}

	cleanRel := filepath.Clean(filepath.ToSlash(filename))
	if strings.HasPrefix(cleanRel, "../") || cleanRel == ".." || filepath.IsAbs(cleanRel) {
		cleanRel = path.Base(cleanRel)
	}
	cleanRel = strings.TrimPrefix(cleanRel, "/")
	if cleanRel == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "Filename is required")
		return
	}

	filePart, _, err := r.FormFile("chunk")
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Missing chunk file part")
		return
	}
	defer filePart.Close()

	chunkData, err := io.ReadAll(io.LimitReader(filePart, 32<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Could not read chunk data")
		return
	}

	tempDir := filepath.Join(os.TempDir(), "barepod-uploads", uploadID)
	if err := os.MkdirAll(tempDir, 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Failed to prepare upload workspace")
		return
	}

	chunkFilePath := filepath.Join(tempDir, fmt.Sprintf("chunk_%05d", chunkIndex))
	if err := os.WriteFile(chunkFilePath, chunkData, 0o644); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Failed to store upload chunk")
		return
	}

	allPresent := true
	for i := 0; i < totalChunks; i++ {
		p := filepath.Join(tempDir, fmt.Sprintf("chunk_%05d", i))
		if _, err := os.Stat(p); err != nil {
			allPresent = false
			break
		}
	}

	if !allPresent {
		writeJSON(w, http.StatusOK, map[string]any{
			"uploadId":    uploadID,
			"chunkIndex":  chunkIndex,
			"totalChunks": totalChunks,
			"completed":   false,
		})
		return
	}

	var assembled bytes.Buffer
	for i := 0; i < totalChunks; i++ {
		p := filepath.Join(tempDir, fmt.Sprintf("chunk_%05d", i))
		data, err := os.ReadFile(p)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Failed to assemble chunks")
			return
		}
		assembled.Write(data)
	}

	if scope.kind == "tenant" {
		if !s.enforceDiskQuota(w, r, scope.label, int64(assembled.Len())) {
			_ = os.RemoveAll(tempDir)
			return
		}
	}

	target := path.Join(strings.TrimPrefix(targetDir, "/"), cleanRel)
	if parent := path.Dir(target); parent != "." && parent != "" {
		_ = scope.manager.Mkdir(parent)
	}

	if _, err := scope.manager.Write(target, assembled.Bytes()); err != nil {
		_ = os.RemoveAll(tempDir)
		s.block(w, r, user, scope, target, err)
		return
	}
	_ = os.RemoveAll(tempDir)

	var extracted []string
	if autoExtract {
		lower := strings.ToLower(target)
		if strings.HasSuffix(lower, ".zip") || strings.HasSuffix(lower, ".tar.gz") || strings.HasSuffix(lower, ".tgz") || strings.HasSuffix(lower, ".tar") {
			destFolder := path.Dir(target)
			if ex, err := scope.manager.Extract(target, destFolder); err == nil {
				extracted = ex
			}
		}
	}

	_ = s.store.Audit(user.ID, "files.upload_resumable", scope.auditTarget(target), clientIP(r), target)
	writeJSON(w, http.StatusCreated, map[string]any{
		"uploadId":  uploadID,
		"completed": true,
		"path":      target,
		"size":      assembled.Len(),
		"extracted": extracted,
	})
}

// handleScopedUploadChunkStatus reports which chunks have been received for resumable uploads in scoped files.
func (s *Server) handleScopedUploadChunkStatus(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	_, ok := s.scopedFilesFor(w, r, user)
	if !ok {
		return
	}
	uploadID := r.URL.Query().Get("uploadId")
	if !validUploadID.MatchString(uploadID) {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid upload ID")
		return
	}

	tempDir := filepath.Join(os.TempDir(), "barepod-uploads", uploadID)
	entries, err := os.ReadDir(tempDir)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"uploadId": uploadID,
			"chunks":   []int{},
		})
		return
	}

	var chunks []int
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "chunk_") {
			idx, err := strconv.Atoi(strings.TrimPrefix(e.Name(), "chunk_"))
			if err == nil {
				chunks = append(chunks, idx)
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"uploadId": uploadID,
		"chunks":   chunks,
	})
}
