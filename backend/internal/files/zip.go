package files

import (
	"archive/zip"
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Zip streams the given paths (files or directories) into a .zip archive.
// Paths are stored relative to the site root, which is what the file manager
// expects when the user downloads a selection.
func (m *Manager) Zip(relatives []string) ([]byte, error) {
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)

	for _, relative := range relatives {
		abs, err := m.Resolve(relative)
		if err != nil {
			return nil, err
		}
		if err := m.addToZip(writer, abs, relative); err != nil {
			_ = writer.Close()
			return nil, err
		}
	}

	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func (m *Manager) addToZip(writer *zip.Writer, abs, relative string) error {
	info, err := m.ops.Stat(abs)
	if err != nil {
		return err
	}
	relative = strings.TrimPrefix(filepath.ToSlash(relative), "/")

	// Never archive unix sockets (e.g. fpm.sock), pipes, or device files
	if info.Mode()&os.ModeSocket != 0 || info.Mode()&os.ModeNamedPipe != 0 || info.Mode()&os.ModeDevice != 0 || strings.HasSuffix(relative, ".sock") || filepath.Base(abs) == "fpm.sock" {
		return nil
	}

	if !info.IsDir() {
		data, err := m.ops.ReadFile(abs)
		if err != nil {
			return err
		}
		return writeZipEntry(writer, relative, info.Mode().Perm(), data)
	}

	if relative != "" {
		if err := writeZipEntry(writer, relative+"/", info.Mode().Perm(), nil); err != nil {
			return err
		}
	}
	entries, err := m.ops.List(abs)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		// Never follow a symlink, socket, or pipe while archiving.
		if entry.Type == "symlink" || entry.Type == "socket" || entry.Type == "fifo" || strings.HasSuffix(entry.Name, ".sock") {
			continue
		}
		if err := m.addToZip(writer, filepath.Join(abs, entry.Name), filepath.Join(relative, entry.Name)); err != nil {
			return err
		}
	}
	return nil
}

func writeZipEntry(writer *zip.Writer, name string, mode os.FileMode, data []byte) error {
	header := &zip.FileHeader{
		Name:   name,
		Method: zip.Deflate,
	}
	header.SetMode(mode)
	if strings.HasSuffix(name, "/") {
		header.SetMode(mode | os.ModeDir)
	}
	w, err := writer.CreateHeader(header)
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return nil
	}
	_, err = io.Copy(w, bytes.NewReader(data))
	return err
}
