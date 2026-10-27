package stack

import (
	"context"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
)

// InstalledRuntimeVersions lists the versions of one runtime that are really on this host, in
// the same terms the Stack screen uses. A site's version switch offers these and nothing else.
// name is "node", "python", "ruby", "go" or "rust"; any other name has none.
func InstalledRuntimeVersions(ctx context.Context, h *host.Host, name string) []string {
	switch name {
	case "node":
		return nodeInstalled(ctx, h, nil)
	case "go":
		return goInstalled(ctx, h)
	case "rust":
		return rustInstalled(ctx, h)
	case "python":
		return aptVersionedInstalled(ctx, h, "python", versionedBinaries("python"))
	case "ruby":
		return aptVersionedInstalled(ctx, h, "ruby", versionedBinaries("ruby"))
	}
	return nil
}

// versionedBinaries finds the minor versions whose binary apt placed in /usr/bin (python3.12,
// ruby3.2), so only those are asked for their version.
func versionedBinaries(prefix string) []string {
	pattern := regexp.MustCompile("^" + prefix + `(\d+\.\d+)$`)
	matches, _ := filepath.Glob("/usr/bin/" + prefix + "*")
	var out []string
	for _, m := range matches {
		if sub := pattern.FindStringSubmatch(strings.TrimSpace(filepath.Base(m))); sub != nil {
			out = append(out, sub[1])
		}
	}
	return out
}
