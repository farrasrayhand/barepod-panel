package api

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/files"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/validate"
)

// fileScope is what one /files request is allowed to browse.
//
//	scope=host   → the whole machine (admin only); system trees are read-only
//	scope=tenant → /home/<tenant> (admin, or that tenant)
//
// The per-website family (/websites/:slug/files) stays as it is: a site root is
// owned by its tenant and needs no protection list.
type fileScope struct {
	manager  *files.Manager
	kind     string // host | tenant
	label    string // "host", or the tenant name
	root     string
	writable bool // false when the scope has protected paths
}

// auditTarget names the object in the audit log, e.g. "host:etc/nginx/nginx.conf".
func (sc fileScope) auditTarget(relative string) string {
	clean := strings.TrimPrefix(path.Clean("/"+strings.TrimPrefix(relative, "/")), "/")
	if clean == "" || clean == "." {
		return sc.label
	}
	return sc.label + ":" + clean
}

// scopedFilesFor resolves a scoped request and answers the client itself when it
// may not proceed.
func (s *Server) scopedFilesFor(w http.ResponseWriter, r *http.Request, user *store.User) (fileScope, bool) {
	switch strings.ToLower(strings.TrimSpace(r.URL.Query().Get("scope"))) {
	case "host":
		if user.Role != "admin" {
			writeError(w, http.StatusForbidden, "forbidden", "Browsing the host filesystem is for administrators only")
			return fileScope{}, false
		}
		// The daemon runs as root here, and the policy is what keeps the machine
		// safe: /etc is readable and impossible to modify.
		manager, err := files.NewManagerGuarded("/", files.DirectOps{}, s.maxUploadBytes, files.SystemPolicy())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not open the host root")
			return fileScope{}, false
		}
		return fileScope{manager: manager, kind: "host", label: "host", root: "/"}, true

	case "tenant":
		name := strings.TrimSpace(r.URL.Query().Get("tenant"))
		if !validate.TenantUser(name) {
			writeError(w, http.StatusBadRequest, "bad_request", "A valid tenant name is required")
			return fileScope{}, false
		}
		// An admin may look at anyone's home; a tenant only at its own.
		if user.Role != "admin" && user.Username != name {
			writeError(w, http.StatusNotFound, "not_found", "No such tenant home")
			return fileScope{}, false
		}
		root := filepath.Join(s.host.SitesRoot, name)
		if info, err := os.Stat(root); err != nil || !info.IsDir() {
			writeError(w, http.StatusNotFound, "not_found", "That tenant has no home directory")
			return fileScope{}, false
		}
		// Operations run as the tenant, so anything created there belongs to the
		// account (and an admin still cannot write into another account's files
		// unless that account could).
		manager, err := files.NewManagerGuarded(root, s.fileOps(name), s.maxUploadBytes, files.Policy{})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not open the tenant home")
			return fileScope{}, false
		}
		return fileScope{manager: manager, kind: "tenant", label: name, root: root}, true
	}

	writeError(w, http.StatusBadRequest, "bad_request", "scope must be \"host\" or \"tenant\"")
	return fileScope{}, false
}

// block writes the refusal that matters: someone tried to change a system path.
func (s *Server) block(w http.ResponseWriter, r *http.Request, user *store.User, scope fileScope, relative string, err error) {
	if errors.Is(err, files.ErrProtected) {
		_ = s.store.Audit(user.ID, "files.blocked", scope.auditTarget(relative), clientIP(r), err.Error())
		writeError(w, http.StatusForbidden, "system_path_protected",
			"That path belongs to the system, so the panel only lets you read it")
		return
	}
	writeFileError(w, err)
}

// handleScopedList lists a directory in the chosen scope.
func (s *Server) handleScopedList(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	scope, ok := s.scopedFilesFor(w, r, user)
	if !ok {
		return
	}
	relative := r.URL.Query().Get("path")
	entries, err := scope.manager.List(relative)
	if err != nil {
		s.block(w, r, user, scope, relative, err)
		return
	}
	// Read-only is a property of the directory being listed, not of the scope: an
	// admin can create files in /tmp and cannot create any in /etc.
	readOnly := scope.manager.Protects(relative)
	if readOnly {
		_ = s.store.Audit(user.ID, "files.read_system", scope.auditTarget(relative), clientIP(r), "")
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path":     relative,
		"scope":    scope.kind,
		"root":     scope.root,
		"readOnly": readOnly,
		"items":    entries,
		"maxSize":  scope.manager.MaxUploadBytes(),
	})
}

// handleScopedRead returns a file's contents (base64 when it is binary).
func (s *Server) handleScopedRead(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	scope, ok := s.scopedFilesFor(w, r, user)
	if !ok {
		return
	}
	relative := r.URL.Query().Get("path")
	data, info, err := scope.manager.Read(relative)
	if err != nil {
		s.block(w, r, user, scope, relative, err)
		return
	}
	if int64(len(data)) > s.maxUploadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "This file is too large to open in the editor")
		return
	}
	protected := scope.manager.Protects(relative)
	if protected {
		_ = s.store.Audit(user.ID, "files.read_system", scope.auditTarget(relative), clientIP(r), fmt.Sprintf("%d bytes", len(data)))
	}

	payload := map[string]any{
		"path":       strings.TrimPrefix(relative, "/"),
		"size":       info.Size(),
		"mode":       fmt.Sprintf("%04o", info.Mode().Perm()),
		"modifiedAt": info.ModTime().UTC().Format(time.RFC3339),
		"binary":     files.IsBinary(data),
		"writable":   !protected,
	}
	if payload["binary"] == true {
		payload["encoding"] = "base64"
		payload["content"] = base64.StdEncoding.EncodeToString(data)
	} else {
		payload["encoding"] = "utf-8"
		payload["content"] = string(data)
	}
	writeJSON(w, http.StatusOK, payload)
}

// handleScopedWrite saves an editor buffer.
func (s *Server) handleScopedWrite(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	scope, ok := s.scopedFilesFor(w, r, user)
	if !ok {
		return
	}
	var req writeFileRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	data := []byte(req.Content)
	if strings.EqualFold(req.Encoding, "base64") {
		decoded, err := base64.StdEncoding.DecodeString(req.Content)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "The content could not be decoded")
			return
		}
		data = decoded
	}
	info, err := scope.manager.Write(req.Path, data)
	if err != nil {
		s.block(w, r, user, scope, req.Path, err)
		return
	}
	_ = s.store.Audit(user.ID, "files.write", scope.auditTarget(req.Path), clientIP(r), fmt.Sprintf("%d bytes", len(data)))
	writeJSON(w, http.StatusOK, map[string]any{
		"path": req.Path, "size": info.Size(),
		"modifiedAt": info.ModTime().UTC().Format("2006-01-02T15:04:05Z"),
	})
}

// handleScopedCreate creates an empty file.
func (s *Server) handleScopedCreate(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	scope, ok := s.scopedFilesFor(w, r, user)
	if !ok {
		return
	}
	var req pathRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	if exists, err := scope.manager.Exists(req.Path); err != nil || exists {
		writeError(w, http.StatusConflict, "already_exists", "That file already exists")
		return
	}
	if _, err := scope.manager.Write(req.Path, nil); err != nil {
		s.block(w, r, user, scope, req.Path, err)
		return
	}
	_ = s.store.Audit(user.ID, "files.create", scope.auditTarget(req.Path), clientIP(r), "")
	writeJSON(w, http.StatusCreated, map[string]any{"path": req.Path})
}

// handleScopedMkdir creates a directory.
func (s *Server) handleScopedMkdir(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	scope, ok := s.scopedFilesFor(w, r, user)
	if !ok {
		return
	}
	var req pathRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	if err := scope.manager.Mkdir(req.Path); err != nil {
		s.block(w, r, user, scope, req.Path, err)
		return
	}
	_ = s.store.Audit(user.ID, "files.mkdir", scope.auditTarget(req.Path), clientIP(r), "")
	writeJSON(w, http.StatusCreated, map[string]any{"path": req.Path})
}

// handleScopedRename renames an entry in place.
func (s *Server) handleScopedRename(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	scope, ok := s.scopedFilesFor(w, r, user)
	if !ok {
		return
	}
	var req renameRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	newPath, err := scope.manager.Rename(req.Path, req.Name)
	if err != nil {
		s.block(w, r, user, scope, req.Path, err)
		return
	}
	_ = s.store.Audit(user.ID, "files.rename", scope.auditTarget(req.Path), clientIP(r), "to "+req.Name)
	writeJSON(w, http.StatusOK, map[string]any{"path": newPath})
}

// handleScopedTransfer copies or moves one entry.
func (s *Server) handleScopedTransfer(w http.ResponseWriter, r *http.Request, user *store.User, action string) {
	scope, ok := s.scopedFilesFor(w, r, user)
	if !ok {
		return
	}
	var req transferRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	dest := req.To
	if dest == "" {
		dest = req.Path
	}
	var err error
	if action == "copy" {
		err = scope.manager.Copy(req.Path, dest)
	} else {
		err = scope.manager.Move(req.Path, dest)
	}
	if err != nil {
		s.block(w, r, user, scope, req.Path, err)
		return
	}
	_ = s.store.Audit(user.ID, "files."+action, scope.auditTarget(req.Path), clientIP(r), "to "+dest)
	writeJSON(w, http.StatusOK, map[string]any{"path": dest})
}

// handleScopedDelete removes one or many entries.
func (s *Server) handleScopedDelete(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	scope, ok := s.scopedFilesFor(w, r, user)
	if !ok {
		return
	}
	var req pathsRequest
	if err := decodeJSON(r, &req); err != nil || len(req.Paths) == 0 {
		writeError(w, http.StatusBadRequest, "bad_request", "At least one path is required")
		return
	}
	deleted := make([]string, 0, len(req.Paths))
	for _, target := range req.Paths {
		if err := scope.manager.Delete(target); err != nil {
			s.block(w, r, user, scope, target, err)
			return
		}
		deleted = append(deleted, target)
	}
	_ = s.store.Audit(user.ID, "files.delete", scope.auditTarget(""), clientIP(r),
		fmt.Sprintf("%d item(s): %s", len(deleted), strings.Join(deleted, ", ")))
	writeJSON(w, http.StatusOK, map[string]any{"deleted": deleted})
}

// handleScopedDownload streams a file (or a zip of the selection) to the client.
func (s *Server) handleScopedDownload(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	scope, ok := s.scopedFilesFor(w, r, user)
	if !ok {
		return
	}
	relative := r.URL.Query().Get("path")
	data, _, err := scope.manager.Read(relative)
	if err != nil {
		s.block(w, r, user, scope, relative, err)
		return
	}
	if scope.manager.Protects(relative) {
		_ = s.store.Audit(user.ID, "files.read_system", scope.auditTarget(relative), clientIP(r), fmt.Sprintf("download %d bytes", len(data)))
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+path.Base(strings.TrimPrefix(relative, "/"))+"\"")
	w.Header().Set("Content-Length", fmt.Sprint(len(data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// handleScopedUpload accepts a multipart upload into the current directory.
func (s *Server) handleScopedUpload(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	scope, ok := s.scopedFilesFor(w, r, user)
	if !ok {
		return
	}
	dir := r.URL.Query().Get("path")
	autoExtract := r.URL.Query().Get("autoExtract") == "true"

	reader, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Expected a multipart upload")
		return
	}

	written := []string{}
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "The upload could not be read")
			return
		}
		if part.FileName() == "" {
			continue
		}
		cleanName := filepath.Clean(filepath.ToSlash(part.FileName()))
		if strings.HasPrefix(cleanName, "../") || cleanName == ".." || filepath.IsAbs(cleanName) {
			cleanName = path.Base(cleanName)
		}
		cleanName = strings.TrimPrefix(cleanName, "/")
		if cleanName == "" {
			continue
		}

		target := path.Join(strings.TrimPrefix(dir, "/"), cleanName)

		data, err := io.ReadAll(scope.manager.LimitReader(part))
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "The upload could not be read")
			return
		}
		if parent := path.Dir(target); parent != "." && parent != "" {
			_ = scope.manager.Mkdir(parent)
		}
		if _, err := scope.manager.Write(target, data); err != nil {
			s.block(w, r, user, scope, target, err)
			return
		}
		written = append(written, target)

		if autoExtract {
			lower := strings.ToLower(target)
			if strings.HasSuffix(lower, ".zip") || strings.HasSuffix(lower, ".tar.gz") || strings.HasSuffix(lower, ".tgz") || strings.HasSuffix(lower, ".tar") {
				targetDir := path.Dir(target)
				_, _ = scope.manager.Extract(target, targetDir)
			}
		}
	}
	if len(written) == 0 {
		writeError(w, http.StatusBadRequest, "bad_request", "No file was uploaded")
		return
	}
	_ = s.store.Audit(user.ID, "files.upload", scope.auditTarget(dir), clientIP(r), strings.Join(written, ", "))
	writeJSON(w, http.StatusCreated, map[string]any{"uploaded": written})
}

// handleScopedCompress zips the selected entries; it is a read, so a protected
// path can be exported even though it can never be changed.
func (s *Server) handleScopedCompress(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	scope, ok := s.scopedFilesFor(w, r, user)
	if !ok {
		return
	}
	var req compressRequest
	if err := decodeJSON(r, &req); err != nil || len(req.Paths) == 0 {
		writeError(w, http.StatusBadRequest, "bad_request", "At least one path is required")
		return
	}
	if len(req.Paths) > maxFilesPerRequest {
		writeError(w, http.StatusBadRequest, "too_many", fmt.Sprintf("At most %d items per request", maxFilesPerRequest))
		return
	}

	if strings.TrimSpace(req.Destination) != "" {
		if err := scope.manager.Compress(req.Paths, req.Destination, req.Format); err != nil {
			s.block(w, r, user, scope, req.Destination, err)
			return
		}
		_ = s.store.Audit(user.ID, "files.compress", scope.auditTarget(req.Destination), clientIP(r),
			fmt.Sprintf("compressed %d items into %s", len(req.Paths), req.Destination))
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":   true,
			"path": strings.TrimPrefix(req.Destination, "/"),
		})
		return
	}

	archive, err := scope.manager.Zip(req.Paths)
	if err != nil {
		s.block(w, r, user, scope, strings.Join(req.Paths, ", "), err)
		return
	}
	_ = s.store.Audit(user.ID, "files.compress_download", scope.auditTarget(""), clientIP(r), fmt.Sprintf("%d item(s)", len(req.Paths)))

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+scope.label+"-"+time.Now().UTC().Format("20060102-150405")+".zip\"")
	w.Header().Set("Content-Length", fmt.Sprint(len(archive)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(archive)
}
