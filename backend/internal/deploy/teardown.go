package deploy

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/supervisor"
)

// Teardown removes a website completely: service, unit, files and records.
//
// Deploying used to leave manual cleanup when a deploy failed, which is exactly
// the kind of work a panel is supposed to do. The destructive step (deleting the
// app directory) is bounded to the site path inside the sites root, so it can
// never walk out of a tenant's apps directory.
func (m *Manager) Teardown(ctx context.Context, slug string) ([]string, error) {
	site, err := m.store.WebsiteBySlug(slug)
	if err != nil {
		return nil, err
	}

	var steps []string
	logf := func(format string, args ...any) {
		steps = append(steps, fmt.Sprintf(format, args...))
	}

	// 1. Stop and disable the service (best effort: it may never have started).
	if _, err := m.host.ServiceAction(ctx, "stop", slug); err != nil && m.host.Materialises() {
		logf("stop failed (continuing): %v", err)
	} else {
		logf("stopped the service")
	}
	if _, err := m.host.ServiceAction(ctx, "disable", slug); err != nil && m.host.Materialises() {
		logf("disable failed (continuing): %v", err)
	} else {
		logf("disabled the unit")
	}

	// 2. Remove the per-site drop-in and let systemd forget it.
	if err := supervisor.Remove(m.host.UnitsDir, slug); err != nil {
		return steps, fmt.Errorf("remove the unit override: %w", err)
	}
	if _, err := m.host.ReloadUnits(ctx); err != nil && m.host.Materialises() {
		logf("daemon-reload failed (continuing): %v", err)
	} else {
		logf("removed the unit override and reloaded systemd")
	}

	// 3. Delete the site directory, guarded so it stays inside the sites root.
	dir := m.host.SitePath(site.TenantUser, slug)
	if err := guardedRemoveAll(m.host.SitesRoot, dir); err != nil {
		return steps, err
	}
	logf("deleted %s", dir)

	// 4. Forget the rows (secrets first, then the website).
	if err := m.store.DeleteWebsiteSecrets(slug); err != nil {
		return steps, err
	}
	if err := m.store.DeleteWebsite(slug); err != nil {
		return steps, err
	}
	logf("removed the panel records")

	return steps, nil
}

// guardedRemoveAll deletes a path only when it sits strictly inside the root and
// is neither the root nor a tenant home.
func guardedRemoveAll(root, target string) error {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	targetAbs, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	rootAbs = filepath.Clean(rootAbs)
	targetAbs = filepath.Clean(targetAbs)

	if targetAbs == rootAbs {
		return fmt.Errorf("refusing to delete the sites root %s", rootAbs)
	}
	if !strings.HasPrefix(targetAbs, rootAbs+string(filepath.Separator)) {
		return fmt.Errorf("refusing to delete %s: outside %s", targetAbs, rootAbs)
	}
	// tenant home itself (sitesRoot/<tenant>) is not a site directory
	if filepath.Dir(targetAbs) == rootAbs {
		return fmt.Errorf("refusing to delete a tenant home: %s", targetAbs)
	}
	if err := os.RemoveAll(targetAbs); err != nil {
		return fmt.Errorf("delete %s: %w", targetAbs, err)
	}
	return nil
}
