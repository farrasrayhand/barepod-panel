package api

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/files"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/validate"
)

// maxFilesPerRequest limits batch operations so one request cannot ask the
// daemon to walk an unbounded number of entries.
const maxFilesPerRequest = 500

// fileOps picks how file operations run: through the tenant-credential helper
// when the daemon is root and the Linux account exists, otherwise in-process.
func (s *Server) fileOps(tenantName string) files.Ops {
	if s.tenants == nil {
		return files.DirectOps{}
	}
	account, ok := s.tenants.Lookup(context.Background(), tenantName)
	if !ok {
		return files.DirectOps{}
	}
	executable, err := os.Executable()
	if err != nil {
		return files.DirectOps{}
	}
	return files.NewOps(executable, account.UID, account.GID)
}

// fileManagerFor resolves the website, checks the caller may touch it, and
// builds a file manager rooted at the site directory.
func (s *Server) fileManagerFor(w http.ResponseWriter, r *http.Request, user *store.User) (*files.Manager, *store.Website, bool) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return nil, nil, false
	}
	// A reverse proxy has no docroot of its own; the UI hides its File Manager,
	// and the API refuses it too (hiding a control is not enforcement).
	if !validate.HasRuntime(site.Runtime) {
		writeError(w, http.StatusConflict, "not_applicable",
			"A reverse proxy has no files of its own — its content lives in the upstream container")
		return nil, nil, false
	}

	root := s.host.SitePath(site.TenantUser, site.Slug)
	manager, err := files.NewManager(root, s.fileOps(site.TenantUser), s.maxUploadBytes)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not open the website directory")
		return nil, nil, false
	}
	return manager, site, true
}

func writeFileError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, files.ErrOutsideRoot), errors.Is(err, files.ErrSymlinkEscape):
		writeError(w, http.StatusForbidden, "path_not_allowed", "That path is outside the website directory")
	case os.IsNotExist(err):
		writeError(w, http.StatusNotFound, "not_found", "No such file or directory")
	case os.IsPermission(err):
		writeError(w, http.StatusForbidden, "forbidden", "Permission denied on the server")
	default:
		writeError(w, http.StatusBadRequest, "file_error", err.Error())
	}
}

// handleListFiles lists a directory inside the website.
func (s *Server) handleListFiles(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	manager, site, ok := s.fileManagerFor(w, r, user)
	if !ok {
		return
	}
	relative := r.URL.Query().Get("path")

	entries, err := manager.List(relative)
	if err != nil {
		writeFileError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path":    strings.TrimPrefix(relative, "/"),
		"site":    site.Slug,
		"tenant":  site.TenantUser,
		"items":   entries,
		"maxSize": manager.MaxUploadBytes(),
	})
}

// handleReadFile returns a file for the editor (text or base64).
func (s *Server) handleReadFile(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	manager, _, ok := s.fileManagerFor(w, r, user)
	if !ok {
		return
	}
	relative := r.URL.Query().Get("path")
	if relative == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "A path is required")
		return
	}

	data, info, err := manager.Read(relative)
	if err != nil {
		writeFileError(w, err)
		return
	}
	if int64(len(data)) > s.maxUploadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "This file is too large to open in the editor")
		return
	}

	payload := map[string]any{
		"path":       strings.TrimPrefix(relative, "/"),
		"size":       info.Size(),
		"mode":       fmt.Sprintf("%04o", info.Mode().Perm()),
		"modifiedAt": info.ModTime().UTC().Format(time.RFC3339),
		"binary":     files.IsBinary(data),
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

type writeFileRequest struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Encoding string `json:"encoding"`
}

// handleWriteFile saves the editor buffer.
func (s *Server) handleWriteFile(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	manager, site, ok := s.fileManagerFor(w, r, user)
	if !ok {
		return
	}

	var req writeFileRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	if strings.TrimSpace(req.Path) == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "A path is required")
		return
	}

	data := []byte(req.Content)
	if strings.EqualFold(req.Encoding, "base64") {
		decoded, err := base64.StdEncoding.DecodeString(req.Content)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "The content is not valid base64")
			return
		}
		data = decoded
	}
	if int64(len(data)) > manager.MaxUploadBytes() {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "The content is larger than the upload limit")
		return
	}

	info, err := manager.Write(req.Path, data)
	if err != nil {
		writeFileError(w, err)
		return
	}
	_ = s.store.Audit(user.ID, "files.write", site.Slug+"/"+strings.TrimPrefix(req.Path, "/"), clientIP(r), fmt.Sprintf("%d bytes", len(data)))
	writeJSON(w, http.StatusOK, map[string]any{
		"path":       strings.TrimPrefix(req.Path, "/"),
		"size":       info.Size(),
		"modifiedAt": info.ModTime().UTC().Format(time.RFC3339),
	})
}

type pathRequest struct {
	Path string `json:"path"`
}

type pathsRequest struct {
	Paths []string `json:"paths"`
}

type renameRequest struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

type transferRequest struct {
	Path string `json:"path"`
	To   string `json:"to"`
}

// handleCreateFile creates an empty file (or truncates nothing — it refuses to
// overwrite an existing file, so a create cannot destroy code by accident).
func (s *Server) handleCreateFile(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	manager, site, ok := s.fileManagerFor(w, r, user)
	if !ok {
		return
	}
	var req pathRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	if strings.TrimSpace(req.Path) == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "A path is required")
		return
	}
	if exists, err := manager.Exists(req.Path); err == nil && exists {
		writeError(w, http.StatusConflict, "already_exists", "That file already exists")
		return
	}
	if _, err := manager.Write(req.Path, nil); err != nil {
		writeFileError(w, err)
		return
	}
	_ = s.store.Audit(user.ID, "files.create", site.Slug+"/"+strings.TrimPrefix(req.Path, "/"), clientIP(r), "")
	writeJSON(w, http.StatusCreated, map[string]any{"path": strings.TrimPrefix(req.Path, "/")})
}

// handleMkdir creates a directory.
func (s *Server) handleMkdir(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	manager, site, ok := s.fileManagerFor(w, r, user)
	if !ok {
		return
	}
	var req pathRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	if err := manager.Mkdir(req.Path); err != nil {
		writeFileError(w, err)
		return
	}
	_ = s.store.Audit(user.ID, "files.mkdir", site.Slug+"/"+strings.TrimPrefix(req.Path, "/"), clientIP(r), "")
	writeJSON(w, http.StatusCreated, map[string]any{"path": strings.TrimPrefix(req.Path, "/")})
}

// handleRenameFiles renames an entry in place.
func (s *Server) handleRenameFiles(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	manager, site, ok := s.fileManagerFor(w, r, user)
	if !ok {
		return
	}
	var req renameRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	newPath, err := manager.Rename(req.Path, req.Name)
	if err != nil {
		writeFileError(w, err)
		return
	}
	_ = s.store.Audit(user.ID, "files.rename", site.Slug+"/"+strings.TrimPrefix(req.Path, "/"), clientIP(r), "to "+req.Name)
	writeJSON(w, http.StatusOK, map[string]any{"path": newPath})
}

// handleCopyFiles duplicates entries into a target directory.
func (s *Server) handleCopyFiles(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	s.transferFiles(w, r, user, "copy")
}

// handleMoveFiles moves entries into a target directory.
func (s *Server) handleMoveFiles(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	s.transferFiles(w, r, user, "move")
}

func (s *Server) transferFiles(w http.ResponseWriter, r *http.Request, user *store.User, action string) {
	manager, site, ok := s.fileManagerFor(w, r, user)
	if !ok {
		return
	}
	var req transferRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	if strings.TrimSpace(req.To) == "" {
		req.To = path.Dir(strings.TrimPrefix(req.Path, "/"))
	}

	dest := path.Join(strings.TrimPrefix(req.To, "/"), path.Base(strings.TrimPrefix(req.Path, "/")))
	// Never overwrite silently: the UI appends a suffix, and a collision here
	// means a stale view, so refuse instead of destroying data.
	if exists, err := manager.Exists(dest); err == nil && exists {
		writeError(w, http.StatusConflict, "already_exists", "A file with that name already exists in the target folder")
		return
	}

	var err error
	if action == "copy" {
		err = manager.Copy(req.Path, dest)
	} else {
		err = manager.Move(req.Path, dest)
	}
	if err != nil {
		writeFileError(w, err)
		return
	}
	_ = s.store.Audit(user.ID, "files."+action, site.Slug+"/"+strings.TrimPrefix(req.Path, "/"), clientIP(r), "to "+dest)
	writeJSON(w, http.StatusOK, map[string]any{"path": dest})
}

// handleDeleteFiles removes the given entries.
func (s *Server) handleDeleteFiles(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	manager, site, ok := s.fileManagerFor(w, r, user)
	if !ok {
		return
	}
	var req pathsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	if len(req.Paths) == 0 {
		writeError(w, http.StatusBadRequest, "bad_request", "Select at least one item")
		return
	}
	if len(req.Paths) > maxFilesPerRequest {
		writeError(w, http.StatusBadRequest, "too_many", fmt.Sprintf("At most %d items per request", maxFilesPerRequest))
		return
	}

	deleted := make([]string, 0, len(req.Paths))
	for _, p := range req.Paths {
		if err := manager.Delete(p); err != nil {
			writeFileError(w, err)
			return
		}
		deleted = append(deleted, strings.TrimPrefix(p, "/"))
	}
	_ = s.store.Audit(user.ID, "files.delete", site.Slug, clientIP(r), fmt.Sprintf("%d item(s): %s", len(deleted), strings.Join(deleted, ", ")))
	writeJSON(w, http.StatusOK, map[string]any{"deleted": deleted})
}

// handleDownloadFile streams one file (or a zip of the selection).
func (s *Server) handleDownloadFile(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	manager, site, ok := s.fileManagerFor(w, r, user)
	if !ok {
		return
	}
	relative := r.URL.Query().Get("path")
	data, info, err := manager.Read(relative)
	if err != nil {
		writeFileError(w, err)
		return
	}
	// Taking a copy of a file out of the panel is worth recording: downloads are
	// how data leaves, so they belong in the audit trail next to the writes.
	_ = s.store.Audit(user.ID, "files.download", site.Slug+"/"+strings.TrimPrefix(relative, "/"), clientIP(r),
		fmt.Sprintf("%d bytes", len(data)))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+path.Base(strings.TrimPrefix(relative, "/"))+"\"")
	w.Header().Set("Content-Length", fmt.Sprint(len(data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
	_ = info
}

// handleCompressFiles returns a .zip of the selected entries.
func (s *Server) handleCompressFiles(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	manager, site, ok := s.fileManagerFor(w, r, user)
	if !ok {
		return
	}
	var req pathsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	if len(req.Paths) == 0 {
		writeError(w, http.StatusBadRequest, "bad_request", "Select at least one item")
		return
	}
	if len(req.Paths) > maxFilesPerRequest {
		writeError(w, http.StatusBadRequest, "too_many", fmt.Sprintf("At most %d items per request", maxFilesPerRequest))
		return
	}

	archive, err := manager.Zip(req.Paths)
	if err != nil {
		writeFileError(w, err)
		return
	}
	_ = s.store.Audit(user.ID, "files.compress", site.Slug, clientIP(r), fmt.Sprintf("%d item(s)", len(req.Paths)))

	name := site.Slug + "-" + time.Now().UTC().Format("20060102-150405") + ".zip"
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+name+"\"")
	w.Header().Set("Content-Length", fmt.Sprint(len(archive)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(archive)
}

// handleUploadFiles accepts a multipart upload into a directory.
func (s *Server) handleUploadFiles(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	manager, site, ok := s.fileManagerFor(w, r, user)
	if !ok {
		return
	}
	dir := r.URL.Query().Get("path")

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
		// Use the base name only: a client must not be able to traverse.
		name := path.Base(strings.ReplaceAll(part.FileName(), "\\", "/"))
		target := path.Join(strings.TrimPrefix(dir, "/"), name)

		data, err := io.ReadAll(manager.LimitReader(part))
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "The upload could not be read")
			return
		}
		if _, err := manager.Write(target, data); err != nil {
			writeFileError(w, err)
			return
		}
		written = append(written, target)
	}

	if len(written) == 0 {
		writeError(w, http.StatusBadRequest, "bad_request", "No file was uploaded")
		return
	}
	_ = s.store.Audit(user.ID, "files.upload", site.Slug, clientIP(r), strings.Join(written, ", "))
	writeJSON(w, http.StatusCreated, map[string]any{"uploaded": written})
}
