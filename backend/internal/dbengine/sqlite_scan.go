package dbengine

import (
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// DetectedDatabase is a SQLite file found inside a website. The panel did not
// create it — the application did — so it is reported, browsable and
// downloadable, and never deleted by the panel.
type DetectedDatabase struct {
	Path       string // absolute path of the file
	Relative   string // path relative to the site root
	SiteSlug   string
	TenantUser string
	SizeBytes  int64
	ModifiedAt string
	Version    string
}

// scanSkip are directories whose contents are dependencies, caches or the
// panel's own trash: a database inside them is not the application's schema.
var scanSkip = map[string]bool{
	"node_modules": true, "vendor": true, ".venv": true, "venv": true,
	".git": true, ".trash": true, "site-packages": true, "__pycache__": true,
	".cache": true, ".next": true, "dist": true, "build": true, "target": true,
}

// scanExtensions are the file names a SQLite database usually carries.
var scanExtensions = []string{".sqlite", ".sqlite3", ".db"}

// ScanSQLiteFiles walks one website and reports the SQLite files inside it.
//
// Bounded on purpose: a fixed depth and a cap on how many files are reported, so
// a site with thousands of files cannot turn a listing into a filesystem crawl.
func ScanSQLiteFiles(siteRoot, slug, tenant string, maxDepth, maxFiles int) ([]DetectedDatabase, error) {
	if maxDepth <= 0 {
		maxDepth = 3
	}
	if maxFiles <= 0 {
		maxFiles = 25
	}
	root := filepath.Clean(siteRoot)
	found := []DetectedDatabase{}

	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil // an unreadable subdirectory must not stop the scan
		}
		if path == root {
			return nil
		}
		name := entry.Name()
		if entry.IsDir() {
			if scanSkip[name] || strings.HasPrefix(name, ".") && name != "." {
				return fs.SkipDir
			}
			if depth(root, path) >= maxDepth {
				return fs.SkipDir
			}
			return nil
		}
		// Journal and WAL files belong to a database, they are not one.
		if strings.HasSuffix(name, "-journal") || strings.HasSuffix(name, "-wal") || strings.HasSuffix(name, "-shm") {
			return nil
		}
		extension := strings.ToLower(filepath.Ext(name))
		matched := false
		for _, candidate := range scanExtensions {
			if extension == candidate {
				matched = true
				break
			}
		}
		if !matched || len(found) >= maxFiles {
			return nil
		}
		ver := SQLiteFileVersion(path)
		if ver == "" {
			return nil
		}
		info, statErr := entry.Info()
		if statErr != nil {
			return nil
		}
		relative, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return nil
		}
		found = append(found, DetectedDatabase{
			Path:       path,
			Relative:   filepath.ToSlash(relative),
			SiteSlug:   slug,
			TenantUser: tenant,
			SizeBytes:  info.Size(),
			ModifiedAt: info.ModTime().UTC().Format("2006-01-02T15:04:05Z"),
			Version:    ver,
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(found, func(i, j int) bool { return found[i].Path < found[j].Path })
	return found, nil
}

// depth counts how far below the root a path sits.
func depth(root, path string) int {
	relative, err := filepath.Rel(root, path)
	if err != nil || relative == "." {
		return 0
	}
	return len(strings.Split(filepath.ToSlash(relative), "/"))
}

// DetectedID is the identifier a detected file gets in the API.
//
// The site and the relative path travel base64url-encoded so the id is a **single
// path segment**: a slash inside it would be read by the router as another path
// segment (the first attempt returned "API route not found"), and keeping the
// layout out of the URL also keeps it out of logs.
func DetectedID(slug, relative string) string {
	payload := slug + "\x00" + strings.TrimPrefix(filepath.ToSlash(relative), "/")
	return "det:sqlite:" + base64.RawURLEncoding.EncodeToString([]byte(payload))
}

// ParseDetectedID splits an id back into its site and path.
func ParseDetectedID(id string) (slug, relative string, ok bool) {
	encoded, found := strings.CutPrefix(id, "det:sqlite:")
	if !found || encoded == "" {
		return "", "", false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return "", "", false
	}
	slug, relative, found = strings.Cut(string(decoded), "\x00")
	if !found || slug == "" || relative == "" {
		return "", "", false
	}
	return slug, relative, true
}

// IsDetectedID reports whether an id came from a scan rather than the ledger.
func IsDetectedID(id string) bool {
	return strings.HasPrefix(id, "det:sqlite:")
}

// SQLiteFileVersion extracts the SQLite version string from the file header.
// It checks the 16-byte magic header ("SQLite format 3\x00") and, if available,
// reads the 4-byte big-endian SQLITE_VERSION_NUMBER at offset 96.
func SQLiteFileVersion(path string) string {
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer func() { _ = file.Close() }()
	header := make([]byte, 100)
	n, err := file.Read(header)
	if err != nil || n < 16 || string(header[:16]) != "SQLite format 3\x00" {
		return ""
	}
	if n >= 100 {
		vnum := binary.BigEndian.Uint32(header[96:100])
		if vnum > 0 {
			major := vnum / 1000000
			minor := (vnum % 1000000) / 1000
			if major > 0 {
				return fmt.Sprintf("%d.%d", major, minor)
			}
		}
	}
	return "3"
}

// FileHasSQLiteHeader checks the first bytes so a file that merely ends in .db is
// not offered as a database.
func FileHasSQLiteHeader(path string) bool {
	return SQLiteFileVersion(path) != ""
}
