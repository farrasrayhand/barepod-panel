package files

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ErrInvalidArchive is returned when an archive format is unsupported or corrupted.
var ErrInvalidArchive = errors.New("files: unsupported or invalid archive format")

// Compress compresses the given relative source paths into destRelative.
// format can be "zip", "tar.gz", "tgz", or auto-detected from destRelative extension.
func (m *Manager) Compress(sources []string, destRelative string, format string) error {
	if len(sources) == 0 {
		return errors.New("files: at least one source file is required")
	}

	destAbs, err := m.Resolve(destRelative)
	if err != nil {
		return err
	}
	if err := m.assertWritable(destAbs); err != nil {
		return err
	}

	lower := strings.ToLower(destRelative)
	if format == "" {
		if strings.HasSuffix(lower, ".tar.gz") || strings.HasSuffix(lower, ".tgz") {
			format = "tar.gz"
		} else if strings.HasSuffix(lower, ".tar") {
			format = "tar"
		} else {
			format = "zip"
		}
	}

	var data []byte
	switch strings.ToLower(format) {
	case "tar.gz", "tgz":
		data, err = m.buildTarGz(sources)
	case "tar":
		data, err = m.buildTar(sources, false)
	case "zip":
		data, err = m.Zip(sources)
	default:
		return fmt.Errorf("files: unsupported compress format %q", format)
	}
	if err != nil {
		return err
	}

	// Ensure destination directory exists
	if err := m.ops.MkdirAll(filepath.Dir(destAbs)); err != nil {
		return err
	}

	return m.ops.WriteFile(destAbs, data, 0o644)
}

func (m *Manager) buildTarGz(sources []string) ([]byte, error) {
	return m.buildTar(sources, true)
}

func (m *Manager) buildTar(sources []string, compressGz bool) ([]byte, error) {
	var buf bytes.Buffer
	var tw *tar.Writer
	var gw *gzip.Writer

	if compressGz {
		gw = gzip.NewWriter(&buf)
		tw = tar.NewWriter(gw)
	} else {
		tw = tar.NewWriter(&buf)
	}

	for _, relative := range sources {
		abs, err := m.Resolve(relative)
		if err != nil {
			return nil, err
		}
		if err := m.addToTar(tw, abs, relative); err != nil {
			_ = tw.Close()
			if gw != nil {
				_ = gw.Close()
			}
			return nil, err
		}
	}

	if err := tw.Close(); err != nil {
		return nil, err
	}
	if gw != nil {
		if err := gw.Close(); err != nil {
			return nil, err
		}
	}
	return buf.Bytes(), nil
}

func (m *Manager) addToTar(tw *tar.Writer, abs, relative string) error {
	info, err := m.ops.Stat(abs)
	if err != nil {
		return err
	}
	cleanRel := strings.TrimPrefix(filepath.ToSlash(relative), "/")
	if cleanRel == "" {
		cleanRel = filepath.Base(abs)
	}

	if !info.IsDir() {
		data, err := m.ops.ReadFile(abs)
		if err != nil {
			return err
		}
		hdr := &tar.Header{
			Name:    cleanRel,
			Mode:    int64(info.Mode().Perm()),
			Size:    int64(len(data)),
			ModTime: info.ModTime(),
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		_, err = tw.Write(data)
		return err
	}

	hdr := &tar.Header{
		Name:     cleanRel + "/",
		Mode:     int64(info.Mode().Perm()),
		Typeflag: tar.TypeDir,
		ModTime:  info.ModTime(),
	}
	if err := tw.WriteHeader(hdr); err != nil {
		return err
	}

	entries, err := m.ops.List(abs)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.Type == "symlink" {
			continue
		}
		if err := m.addToTar(tw, filepath.Join(abs, entry.Name), filepath.Join(cleanRel, entry.Name)); err != nil {
			return err
		}
	}
	return nil
}

// Extract unpacks an archive (.zip, .tar.gz, .tgz, .tar) into destDirRelative.
// It enforces strict path jail validation (ZipSlip / TarSlip protection).
func (m *Manager) Extract(archiveRelative, destDirRelative string) ([]string, error) {
	archiveAbs, err := m.Resolve(archiveRelative)
	if err != nil {
		return nil, err
	}
	destAbs, err := m.Resolve(destDirRelative)
	if err != nil {
		return nil, err
	}
	if err := m.assertWritable(destAbs); err != nil {
		return nil, err
	}

	data, err := m.ops.ReadFile(archiveAbs)
	if err != nil {
		return nil, err
	}

	if err := m.ops.MkdirAll(destAbs); err != nil {
		return nil, err
	}

	lower := strings.ToLower(archiveRelative)
	if strings.HasSuffix(lower, ".zip") {
		return m.extractZip(data, destAbs)
	}
	if strings.HasSuffix(lower, ".tar.gz") || strings.HasSuffix(lower, ".tgz") {
		return m.extractTar(data, destAbs, true)
	}
	if strings.HasSuffix(lower, ".tar") {
		return m.extractTar(data, destAbs, false)
	}

	// Try auto-detection by sniffing header magic bytes
	if len(data) >= 4 && bytes.Equal(data[:4], []byte{0x50, 0x4b, 0x03, 0x04}) {
		return m.extractZip(data, destAbs)
	}
	if len(data) >= 2 && bytes.Equal(data[:2], []byte{0x1f, 0x8b}) {
		return m.extractTar(data, destAbs, true)
	}

	return nil, ErrInvalidArchive
}

func (m *Manager) extractZip(data []byte, destAbs string) ([]string, error) {
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("files: invalid zip archive: %w", err)
	}

	var extracted []string
	destClean := filepath.Clean(destAbs)

	for _, f := range r.File {
		cleanName := filepath.Clean(filepath.ToSlash(f.Name))
		if strings.HasPrefix(cleanName, "..") || strings.HasPrefix(cleanName, "/") || filepath.IsAbs(cleanName) {
			continue // ZipSlip protection
		}

		target := filepath.Join(destClean, cleanName)
		if !strings.HasPrefix(target, destClean+string(filepath.Separator)) && target != destClean {
			continue // ZipSlip escape protection
		}

		if f.FileInfo().IsDir() {
			if err := m.ops.MkdirAll(target); err != nil {
				return nil, err
			}
			extracted = append(extracted, cleanName+"/")
			continue
		}

		if err := m.ops.MkdirAll(filepath.Dir(target)); err != nil {
			return nil, err
		}

		rc, err := f.Open()
		if err != nil {
			return nil, err
		}

		// Enforce reasonable single-file extraction limit (max 256MB)
		content, err := io.ReadAll(io.LimitReader(rc, 256<<20))
		_ = rc.Close()
		if err != nil {
			return nil, err
		}

		mode := f.Mode().Perm()
		if mode == 0 {
			mode = 0o644
		}
		if err := m.ops.WriteFile(target, content, mode); err != nil {
			return nil, err
		}
		extracted = append(extracted, cleanName)
	}

	return extracted, nil
}

func (m *Manager) extractTar(data []byte, destAbs string, isGzip bool) ([]string, error) {
	var tr *tar.Reader
	if isGzip {
		gr, err := gzip.NewReader(bytes.NewReader(data))
		if err != nil {
			return nil, fmt.Errorf("files: invalid gzip header: %w", err)
		}
		defer gr.Close()
		tr = tar.NewReader(gr)
	} else {
		tr = tar.NewReader(bytes.NewReader(data))
	}

	var extracted []string
	destClean := filepath.Clean(destAbs)

	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}

		cleanName := filepath.Clean(filepath.ToSlash(hdr.Name))
		if strings.HasPrefix(cleanName, "..") || strings.HasPrefix(cleanName, "/") || filepath.IsAbs(cleanName) {
			continue // TarSlip protection
		}

		target := filepath.Join(destClean, cleanName)
		if !strings.HasPrefix(target, destClean+string(filepath.Separator)) && target != destClean {
			continue
		}

		if hdr.Typeflag == tar.TypeDir {
			if err := m.ops.MkdirAll(target); err != nil {
				return nil, err
			}
			extracted = append(extracted, cleanName+"/")
			continue
		}

		if hdr.Typeflag == tar.TypeReg || hdr.Typeflag == tar.TypeRegA {
			if err := m.ops.MkdirAll(filepath.Dir(target)); err != nil {
				return nil, err
			}
			content, err := io.ReadAll(io.LimitReader(tr, 256<<20))
			if err != nil {
				return nil, err
			}

			mode := os.FileMode(hdr.Mode).Perm()
			if mode == 0 {
				mode = 0o644
			}
			if err := m.ops.WriteFile(target, content, mode); err != nil {
				return nil, err
			}
			extracted = append(extracted, cleanName)
		}
	}

	return extracted, nil
}
