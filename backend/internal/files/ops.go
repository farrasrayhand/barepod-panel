package files

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"
)

// DirectOps performs the filesystem work in the daemon process.
// It is used when the daemon is not root (development, macOS), where the
// process already owns the files it writes.
type DirectOps struct{}

// List implements Ops.
func (DirectOps) List(dir string) ([]Entry, error) {
	items, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make([]Entry, 0, len(items))
	for _, item := range items {
		info, err := item.Info() // lstat: a symlink reports itself
		if err != nil {
			continue
		}
		out = append(out, entryFromInfo(dir, item.Name(), info))
	}
	return out, nil
}

// ReadFile implements Ops.
func (DirectOps) ReadFile(p string) ([]byte, error) { return os.ReadFile(p) }

// WriteFile implements Ops.
func (DirectOps) WriteFile(p string, data []byte, mode os.FileMode) error {
	return os.WriteFile(p, data, mode)
}

// MkdirAll implements Ops.
func (DirectOps) MkdirAll(p string) error { return os.MkdirAll(p, 0o755) }

// Remove implements Ops.
func (DirectOps) Remove(p string) error { return os.RemoveAll(p) }

// Rename implements Ops.
func (DirectOps) Rename(oldPath, newPath string) error { return os.Rename(oldPath, newPath) }

// Stat implements Ops.
func (DirectOps) Stat(p string) (os.FileInfo, error) { return os.Lstat(p) }

// --- helper process ---

// helperRequest is one operation sent to the privileged helper.
type helperRequest struct {
	Op   string `json:"op"`
	Path string `json:"path"`
	To   string `json:"to"`
	Data []byte `json:"data,omitempty"`
	Mode uint32 `json:"mode,omitempty"`
}

// helperInfo mirrors os.FileInfo across the process boundary.
type helperInfo struct {
	Name       string `json:"name"`
	Size       int64  `json:"size"`
	Mode       uint32 `json:"mode"`
	Dir        bool   `json:"dir"`
	ModifiedAt string `json:"modifiedAt"`
}

type helperResponse struct {
	Entries []Entry     `json:"entries,omitempty"`
	Data    []byte      `json:"data,omitempty"`
	Info    *helperInfo `json:"info,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// HelperOps runs every operation in a child process started with the tenant's
// UID/GID. That is what makes the isolation real: the kernel applies the
// tenant's own permissions, and files created through the panel belong to the
// tenant instead of root.
type HelperOps struct {
	Executable string // path to the barepod binary
	UID, GID   int
}

// Name is the hidden subcommand the helper uses.
const HelperCommand = "fs-exec"

// NewOps returns the safest implementation available on this host.
func NewOps(executable string, uid, gid int) Ops {
	if executable != "" && uid > 0 {
		return &HelperOps{Executable: executable, UID: uid, GID: gid}
	}
	return DirectOps{}
}

func (h *HelperOps) call(req helperRequest) (*helperResponse, error) {
	payload, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	cmd := exec.Command(h.Executable, HelperCommand)
	cmd.Stdin = bytes.NewReader(payload)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Credential: &syscall.Credential{Uid: uint32(h.UID), Gid: uint32(h.GID)},
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if msg := stderr.String(); msg != "" {
			return nil, fmt.Errorf("files: helper failed: %s", trimSpace(msg))
		}
		return nil, fmt.Errorf("files: helper failed: %w", err)
	}

	var resp helperResponse
	if err := json.Unmarshal(stdout.Bytes(), &resp); err != nil {
		return nil, fmt.Errorf("files: helper returned an unreadable answer: %w", err)
	}
	if resp.Error != "" {
		return nil, fmt.Errorf("files: %s", resp.Error)
	}
	return &resp, nil
}

func trimSpace(s string) string {
	for len(s) > 0 && (s[len(s)-1] == '\n' || s[len(s)-1] == '\r' || s[len(s)-1] == ' ') {
		s = s[:len(s)-1]
	}
	return s
}

// List implements Ops.
func (h *HelperOps) List(dir string) ([]Entry, error) {
	resp, err := h.call(helperRequest{Op: "list", Path: dir})
	if err != nil {
		return nil, err
	}
	return resp.Entries, nil
}

// ReadFile implements Ops.
func (h *HelperOps) ReadFile(p string) ([]byte, error) {
	resp, err := h.call(helperRequest{Op: "read", Path: p})
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// WriteFile implements Ops.
func (h *HelperOps) WriteFile(p string, data []byte, mode os.FileMode) error {
	_, err := h.call(helperRequest{Op: "write", Path: p, Data: data, Mode: uint32(mode.Perm())})
	return err
}

// MkdirAll implements Ops.
func (h *HelperOps) MkdirAll(p string) error {
	_, err := h.call(helperRequest{Op: "mkdir", Path: p})
	return err
}

// Remove implements Ops.
func (h *HelperOps) Remove(p string) error {
	_, err := h.call(helperRequest{Op: "remove", Path: p})
	return err
}

// Rename implements Ops.
func (h *HelperOps) Rename(oldPath, newPath string) error {
	_, err := h.call(helperRequest{Op: "rename", Path: oldPath, To: newPath})
	return err
}

// Stat implements Ops.
func (h *HelperOps) Stat(p string) (os.FileInfo, error) {
	resp, err := h.call(helperRequest{Op: "stat", Path: p})
	if err != nil {
		return nil, err
	}
	if resp.Info == nil {
		return nil, os.ErrNotExist
	}
	modified := time.Time{}
	if resp.Info.ModifiedAt != "" {
		if parsed, err := time.Parse(time.RFC3339, resp.Info.ModifiedAt); err == nil {
			modified = parsed
		}
	}
	return fileInfoStub{
		name:    resp.Info.Name,
		size:    resp.Info.Size,
		mode:    os.FileMode(resp.Info.Mode),
		dir:     resp.Info.Dir,
		modTime: modified,
	}, nil
}

// fileInfoStub lets the helper's answer satisfy os.FileInfo.
type fileInfoStub struct {
	name    string
	size    int64
	mode    os.FileMode
	dir     bool
	modTime time.Time
}

func (f fileInfoStub) Name() string       { return f.name }
func (f fileInfoStub) Size() int64        { return f.size }
func (f fileInfoStub) Mode() os.FileMode  { return f.mode }
func (f fileInfoStub) ModTime() time.Time { return f.modTime }
func (f fileInfoStub) IsDir() bool        { return f.dir }
func (f fileInfoStub) Sys() any           { return nil }

// RunHelper executes one operation inside the helper process. It is called by
// the hidden `barepod fs-exec` subcommand, which the daemon starts with the
// tenant's credentials.
func RunHelper(reqJSON []byte) []byte {
	var req helperRequest
	if err := json.Unmarshal(reqJSON, &req); err != nil {
		return marshalHelper(helperResponse{Error: "unreadable request"})
	}

	ops := DirectOps{}
	var resp helperResponse

	switch req.Op {
	case "list":
		entries, err := ops.List(req.Path)
		if err != nil {
			resp.Error = err.Error()
		}
		resp.Entries = entries
	case "read":
		data, err := ops.ReadFile(req.Path)
		if err != nil {
			resp.Error = err.Error()
		}
		resp.Data = data
	case "write":
		if err := ops.WriteFile(req.Path, req.Data, os.FileMode(req.Mode)); err != nil {
			resp.Error = err.Error()
		}
	case "mkdir":
		if err := ops.MkdirAll(req.Path); err != nil {
			resp.Error = err.Error()
		}
	case "remove":
		if err := ops.Remove(req.Path); err != nil {
			resp.Error = err.Error()
		}
	case "rename":
		if err := ops.Rename(req.Path, req.To); err != nil {
			resp.Error = err.Error()
		}
	case "stat":
		info, err := ops.Stat(req.Path)
		if err != nil {
			resp.Error = err.Error()
			break
		}
		resp.Info = &helperInfo{
			Name:       info.Name(),
			Size:       info.Size(),
			Mode:       uint32(info.Mode().Perm()),
			Dir:        info.IsDir(),
			ModifiedAt: info.ModTime().UTC().Format(time.RFC3339),
		}
	default:
		resp.Error = "unknown operation " + req.Op
	}
	return marshalHelper(resp)
}

func marshalHelper(resp helperResponse) []byte {
	out, err := json.Marshal(resp)
	if err != nil {
		return []byte(`{"error":"could not encode the answer"}`)
	}
	return out
}
