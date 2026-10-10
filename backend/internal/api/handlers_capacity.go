package api

import (
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/rbac"
	"github.com/farrasrayhand/barepod-panel/backend/internal/resources"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
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

// usages turns the stored groups into resource claims.
func usages(groups []rbac.Group) []resources.Usage {
	out := make([]resources.Usage, 0, len(groups))
	for _, g := range groups {
		out = append(out, resources.Usage{Name: g.Name, Members: g.Members, Limits: g.Limits})
	}
	return out
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
	claims := usages(groups)
	allocation := resources.Allocation(claims)
	ratios := resources.Ratios(allocation, capacity)
	exceeds := resources.Exceeds(claims, capacity)
	s.noteCapacityChange(exceeds)

	writeJSON(w, http.StatusOK, map[string]any{
		"capacity":   capacity,
		"allocation": allocation,
		"usage":      ratios,
		"fits":       ratios.Fits(),
		"exceeds":    exceeds,
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
	if limits.CPUQuotaPercent < 0 || limits.MemoryMB < 0 || limits.TasksMax < 0 ||
		limits.DiskQuotaGB < 0 || limits.InodeQuota < 0 || limits.MaxSites < 0 || limits.MaxDatabases < 0 {
		writeJSON(w, http.StatusBadRequest, validationResponse(
			map[string]string{"limits": "limits cannot be negative"}, "Invalid package limits"))
		return
	}

	// Guard: the whole plan (all packages × their members) must fit this server.
	groups, err := s.store.ListGroups()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not read the packages")
		return
	}
	prospective := make([]resources.Usage, 0, len(groups))
	for _, g := range groups {
		if g.Name == name {
			prospective = append(prospective, resources.Usage{Name: g.Name, Members: g.Members, Limits: limits})
			continue
		}
		prospective = append(prospective, resources.Usage{Name: g.Name, Members: g.Members, Limits: g.Limits})
	}
	capacity := resources.DetectCapacity(s.host.SitesRoot)
	if err := resources.Validate(prospective, capacity); err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":    apiError{Code: "insufficient_capacity", Message: err.Error()},
			"capacity": capacity,
			"usage":    resources.Allocation(prospective),
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
	writeJSON(w, http.StatusOK, updated)
}
