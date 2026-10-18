package api

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/rbac"
	"github.com/farrasrayhand/barepod-panel/backend/internal/resources"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/supervisor"
)

// capacityWarnings memoises the last verdict so a resize is logged/audited once
// rather than on every poll.
var capacityWarnings struct {
	sync.Mutex
	last string
}

// noteCapacityChange logs (and reports) when the plan stops fitting the host,
// which is what happens after a scale-down. It is called on every capacity read.
func (s *Server) noteCapacityChange(problems []string) {
	verdict := strings.Join(problems, "; ")
	capacityWarnings.Lock()
	defer capacityWarnings.Unlock()
	if verdict == capacityWarnings.last {
		return
	}
	capacityWarnings.last = verdict
	if verdict == "" {
		log.Print("capacity: the packages fit this server again")
		return
	}
	log.Printf("capacity: WARNING — the packages no longer fit this server: %s", verdict)
	_ = s.store.Audit("", "system.capacity_exceeded", "packages", "", verdict)
}

// limitsForTenant resolves the resource limits of a tenant's group.
// An unknown account or group means "unlimited" (zero), never a lockout.
func (s *Server) limitsForTenant(tenant string) resources.Limits {
	account, err := s.store.UserByUsername(tenant)
	if err != nil {
		return resources.Limits{}
	}
	group, err := s.store.GroupByName(account.GroupName)
	if err != nil {
		return resources.Limits{}
	}
	return group.Limits
}

// sharingPolicy reads which resources the operator has chosen to share (overcommit)
// rather than reserve. An unset or unreadable setting is the zero value — every
// resource reserved — so a failure can never accidentally loosen the guard.
func (s *Server) sharingPolicy() resources.Sharing {
	policy, err := s.store.Sharing()
	if err != nil {
		return resources.Sharing{}
	}
	return policy
}

// reapplyResourceLimits rewrites the resource-controls drop-in of every deployed site
// under the current sharing policy, then reloads systemd. It is what makes a policy
// change take effect on sites that are already running instead of waiting for each
// site's next deploy. Only resources.conf is touched, so no runtime content is rebuilt.
func (s *Server) reapplyResourceLimits(ctx context.Context) {
	if !s.host.Materialises() {
		return
	}
	sites, err := s.store.ListWebsites()
	if err != nil {
		return
	}
	policy := s.sharingPolicy()
	changed := 0
	for _, site := range sites {
		switch site.Runtime {
		case "proxy", "static":
			// No supervised daemon, so no unit and no cgroup limits to set.
			continue
		}
		// Only a site that has actually been deployed: a drop-in written for a site with
		// no unit yet would be a limit attached to nothing.
		override := filepath.Join(supervisor.DropInDir(s.host.UnitsDir, site.Slug), "override.conf")
		if _, err := os.Stat(override); err != nil {
			continue
		}
		limits := s.limitsForTenant(site.TenantUser)
		quota, weight := resources.CPUPlan(limits, policy)
		spec := supervisor.Spec{
			Slug:        site.Slug,
			MemoryMaxMB: limits.MemoryMB,
			CPUQuota:    quota,
			CPUWeight:   weight,
			TasksMax:    limits.TasksMax,
		}
		if _, err := supervisor.WriteResources(s.host.UnitsDir, site.Slug, spec); err != nil {
			continue
		}
		changed++
	}
	if changed == 0 {
		return
	}
	// systemd re-applies cgroup resource controls to active units on daemon-reload, so a
	// running site picks up the new quota/share without being restarted.
	_, _ = s.host.Runner.Run(ctx, "", "systemctl", "daemon-reload")
}

// usages turns the stored groups into resource claims.
func usages(groups []rbac.Group) []resources.Usage {
	out := make([]resources.Usage, 0, len(groups))
	for _, g := range groups {
		out = append(out, resources.Usage{Name: g.Name, Members: g.Members, Limits: g.Limits})
	}
	return out
}

// guardPlan validates a prospective package plan against the live host capacity.
// override replaces that package's limits in the plan (a package being edited or
// added); delta adjusts member counts for the package(s) named (a member being
// added or moved). It returns the capacity and the resulting allocation so a
// caller can report the numbers when the plan does not fit.
func (s *Server) guardPlan(override *rbac.Group, delta map[string]int) (resources.Capacity, resources.Limits, error) {
	groups, err := s.store.ListGroups()
	if err != nil {
		return resources.Capacity{}, resources.Limits{}, err
	}
	prospective := make([]resources.Usage, 0, len(groups)+1)
	seen := make(map[string]bool, len(groups))
	for _, g := range groups {
		usage := resources.Usage{Name: g.Name, Members: g.Members, Limits: g.Limits}
		if override != nil && g.Name == override.Name {
			usage.Limits = override.Limits
		}
		if d, ok := delta[g.Name]; ok {
			usage.Members += d
			if usage.Members < 0 {
				usage.Members = 0
			}
		}
		seen[g.Name] = true
		prospective = append(prospective, usage)
	}
	if override != nil && !seen[override.Name] {
		members := 0
		if d, ok := delta[override.Name]; ok && d > 0 {
			members = d
		}
		prospective = append(prospective, resources.Usage{Name: override.Name, Members: members, Limits: override.Limits})
	}
	capacity := resources.DetectCapacity(s.host.SitesRoot)
	return capacity, resources.Allocation(prospective), resources.Validate(prospective, capacity, s.sharingPolicy())
}

// handleCapacity reports what the host has, what the packages claim, and whether
// the plan fits — so the operator can see the ceiling before allocating.
//
// Capacity is measured live on every call: after a scale up/down the answer
// changes without restarting the daemon, and a plan that no longer fits is
// listed in "exceeds" (the daemon also logs and audits that change once).
func (s *Server) handleCapacity(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	groups, err := s.store.ListGroups()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not read the packages")
		return
	}

	capacity := resources.DetectCapacity(s.host.SitesRoot)
	policy := s.sharingPolicy()
	claims := usages(groups)
	allocation := resources.Allocation(claims)
	ratios := resources.Ratios(allocation, capacity)
	exceeds := resources.Exceeds(claims, capacity, policy)
	s.noteCapacityChange(exceeds)

	writeJSON(w, http.StatusOK, map[string]any{
		"capacity":   capacity,
		"allocation": allocation,
		"usage":      ratios,
		"fits":       ratios.Fits(policy),
		"exceeds":    exceeds,
		"overcommit": policy,
		"suggested":  capacity.Suggest(),
		"packages":   claims,
		"mode":       s.host.Mode(),
		"checkedAt":  time.Now().UTC().Format(time.RFC3339),
	})
}

type updateGroupRequest struct {
	Description *string           `json:"description"`
	Permissions map[string]bool   `json:"permissions"`
	Limits      *resources.Limits `json:"limits"`
}

// handleUpdateGroup edits a package: capabilities and/or resource limits.
// The capacity guard rejects an allocation larger than the server, with the
// numbers, instead of silently overcommitting the machine.
func (s *Server) handleUpdateGroup(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	name := r.PathValue("name")
	group, err := s.store.GroupByName(name)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Package not found")
		return
	}

	var req updateGroupRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}

	description := group.Description
	if req.Description != nil {
		description = strings.TrimSpace(*req.Description)
	}
	permissions := group.Permissions
	if req.Permissions != nil {
		permissions = rbac.Permissions(req.Permissions).Normalised()
	}
	limits := group.Limits
	if req.Limits != nil {
		limits = *req.Limits
	}
	if limits.CPUQuotaPercent < 0 || limits.CPUWeight < 0 || limits.MemoryMB < 0 || limits.TasksMax < 0 ||
		limits.DiskQuotaGB < 0 || limits.InodeQuota < 0 || limits.MaxSites < 0 || limits.MaxDatabases < 0 {
		writeJSON(w, http.StatusBadRequest, validationResponse(
			map[string]string{"limits": "limits cannot be negative"}, "Invalid package limits"))
		return
	}

	// Guard: the whole plan (all packages × their members) must fit this server.
	capacity, allocation, err := s.guardPlan(&rbac.Group{Name: name, Limits: limits}, nil)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":    apiError{Code: "insufficient_capacity", Message: err.Error()},
			"capacity": capacity,
			"usage":    allocation,
		})
		return
	}

	if err := s.store.UpdateGroup(name, description, permissions, limits); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not update the package")
		return
	}
	_ = s.store.Audit(user.ID, "group.update", name, clientIP(r), limits.Describe())

	updated, err := s.store.GroupByName(name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not reload the package")
		return
	}
	// The limits may have changed: re-apply the disk/inode quota to every member so
	// a package edit is not merely a stored number.
	s.reapplyGroupQuota(r.Context(), updated)
	writeJSON(w, http.StatusOK, updated)
}
