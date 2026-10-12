package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/auth"
	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
	"github.com/farrasrayhand/barepod-panel/backend/internal/rbac"
	"github.com/farrasrayhand/barepod-panel/backend/internal/resources"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/tenant"
	"github.com/farrasrayhand/barepod-panel/backend/internal/validate"
)

// roleForGroup keeps the two halves of authorisation in step: capabilities come
// from the group, but cross-tenant visibility keys off Role, so membership of the
// Root group is exactly what "admin" means.
func roleForGroup(groupName string) string {
	if groupName == rbac.RootGroup {
		return "admin"
	}
	return "user"
}

// provisionTenantAccount creates (or reconciles) the Linux account behind a panel
// account and applies the package's disk/inode quota. It is safe to call again:
// Provision skips useradd for an existing account and still sets the quota.
func (s *Server) provisionTenantAccount(ctx context.Context, username string, group *rbac.Group) (*tenant.Result, error) {
	if s.tenants == nil || group == nil {
		return nil, nil
	}
	return s.tenants.Provision(ctx, username, tenant.Options{
		Shell:       "/bin/bash",
		QuotaBytes:  group.Limits.DiskQuotaBytes(),
		QuotaInodes: int64(group.Limits.InodeQuota),
		Filesystem:  "/",
	}, nil)
}

// provisionView reports what the provisioning step actually did, so a caller (and
// the screen) is never told an account exists when the host could not make one.
func provisionView(mode string, r *tenant.Result) map[string]any {
	out := map[string]any{"mode": mode}
	if r != nil {
		out["home"] = r.Home
		out["created"] = r.Created
		out["quotaSet"] = r.QuotaSet
		out["notes"] = r.Notes
	}
	return out
}

// reapplyGroupQuota re-provisions every member of a package after its limits
// changed, so a disk/inode change takes effect without a CLI visit. cgroup limits
// (MemoryMax/CPUQuota/TasksMax) still land on a site at its next deploy — that is
// a documented limitation, not a silent promise.
func (s *Server) reapplyGroupQuota(ctx context.Context, group *rbac.Group) {
	if s.tenants == nil || group == nil {
		return
	}
	users, err := s.store.ListUsers()
	if err != nil {
		return
	}
	for _, u := range users {
		if u.GroupName == group.Name {
			_, _ = s.provisionTenantAccount(ctx, u.Username, group)
		}
	}
}

// isLastAdmin reports whether the named admin is the only one left, so the panel
// never suspends or deletes its way into having no administrator.
func (s *Server) isLastAdmin(username string) (bool, error) {
	users, err := s.store.ListUsers()
	if err != nil {
		return false, err
	}
	others := 0
	for _, u := range users {
		if u.Role == "admin" && u.Username != username {
			others++
		}
	}
	return others == 0, nil
}

// tenantUserView is one account as the Tenants screen needs it: its package, the
// Linux home, whether that account really exists on the host, and how much of the
// package's site/database allowance is in use.
func (s *Server) tenantUserView(u *store.User) map[string]any {
	group, _ := s.store.GroupByName(u.GroupName)
	maxSites, maxDatabases := 0, 0
	if group != nil {
		maxSites = group.Limits.MaxSites
		maxDatabases = group.Limits.MaxDatabases
	}
	sites, _ := s.store.CountWebsitesByTenant(u.Username)
	databases, _ := s.store.CountDatabasesByTenant(u.Username)

	home := ""
	osExists := false
	if s.tenants != nil {
		home = s.tenants.Home(u.Username)
		if _, ok := s.tenants.Lookup(context.Background(), u.Username); ok {
			osExists = true
		}
	}
	return map[string]any{
		"id":        u.ID,
		"username":  u.Username,
		"email":     u.Email,
		"role":      u.Role,
		"groupName": u.GroupName,
		"status":    u.Status,
		"createdAt": u.CreatedAt,
		"home":      home,
		"osExists":  osExists,
		"sites":     map[string]any{"used": sites, "max": maxSites},
		"databases": map[string]any{"used": databases, "max": maxDatabases},
	}
}

// setTenantSitesStatus carries an account's suspension down to the services it
// owns: a suspended owner's websites are stopped and marked `suspended` so the
// state is visible and a start is refused until the account is active again. On
// reactivation the sites are marked `stopped` — left down for the operator to
// start, not started by themselves.
func (s *Server) setTenantSitesStatus(ctx context.Context, username, accountStatus string) {
	sites, err := s.store.ListWebsitesByTenant(username)
	if err != nil {
		return
	}
	for _, site := range sites {
		if accountStatus == "active" {
			if site.Status == "suspended" {
				_ = s.store.SetWebsiteRuntimeState(site.Slug, "stopped", site.DeployStatus)
				_ = s.store.Audit("", "website.released", site.Slug, "", "owner activated")
			}
			continue
		}
		if _, err := s.host.ServiceAction(ctx, "stop", site.Slug); err != nil && s.host.Materialises() {
			_ = s.store.Audit("", "website.suspend_failed", site.Slug, "", err.Error())
		}
		_ = s.store.SetWebsiteRuntimeState(site.Slug, "suspended", site.DeployStatus)
		_ = s.store.Audit("", "website.suspended", site.Slug, "", "owner suspended")
	}
}

// handleListUsers lists every panel account with its package and usage.
func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	users, err := s.store.ListUsers()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not list the accounts")
		return
	}
	items := make([]map[string]any, 0, len(users))
	for i := range users {
		items = append(items, s.tenantUserView(&users[i]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "mode": s.host.Mode()})
}

type createUserRequest struct {
	Username  string `json:"username"`
	Email     string `json:"email"`
	Password  string `json:"password"`
	GroupName string `json:"groupName"`
}

// handleCreateUser creates a panel account and the Linux account behind it. The
// package the account joins is what its limits and capabilities come from, and the
// new member is counted against the server's capacity before anything is created.
func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request, actor *store.User, _ *store.Session) {
	var req createUserRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	username := strings.TrimSpace(strings.ToLower(req.Username))
	groupName := strings.TrimSpace(req.GroupName)
	if !validate.TenantUser(username) {
		writeJSON(w, http.StatusBadRequest, validationResponse(
			map[string]string{"username": "must start with a lowercase letter or underscore, then lowercase letters, digits, _ or -"},
			"Invalid account name"))
		return
	}
	group, err := s.store.GroupByName(groupName)
	if err != nil {
		writeError(w, http.StatusConflict, "no_such_group", "No such package: "+groupName)
		return
	}
	if _, err := s.store.UserByUsername(username); err == nil {
		writeError(w, http.StatusConflict, "already_exists", "An account named "+username+" already exists")
		return
	}

	password := req.Password
	generated := false
	if password == "" {
		password = id.Token(12)
		generated = true
	}
	if len(password) < 12 {
		writeJSON(w, http.StatusBadRequest, validationResponse(
			map[string]string{"password": "a password must be at least 12 characters"}, "Invalid password"))
		return
	}

	// The new member adds to the package's claim; the plan must still fit the host.
	capacity, allocation, err := s.guardPlan(group, map[string]int{group.Name: 1})
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":    apiError{Code: "insufficient_capacity", Message: err.Error()},
			"capacity": capacity,
			"usage":    allocation,
		})
		return
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not hash the password")
		return
	}

	// The Linux identity is mandatory where it can be made: create it first and only
	// record the panel account once it exists, so no account is ever left without one.
	// Off Linux (dry-run) nothing can be created — the account is recorded and both
	// the response and the screen say the OS account is still missing.
	linux, provErr := s.provisionTenantAccount(r.Context(), username, group)
	if provErr != nil {
		writeError(w, http.StatusBadGateway, "provisioning_failed", "Could not create the Linux account: "+provErr.Error())
		return
	}
	if s.host.Materialises() && s.tenants != nil {
		if _, ok := s.tenants.Lookup(r.Context(), username); !ok {
			writeError(w, http.StatusBadGateway, "linux_account_missing",
				"The Linux account could not be created on this host; the account was not added")
			return
		}
	}

	created, err := s.store.CreateUser(username, strings.TrimSpace(req.Email), hash, roleForGroup(group.Name), group.Name)
	if err != nil {
		writeError(w, http.StatusConflict, "already_exists", "Could not create the account")
		return
	}
	_ = s.store.Audit(actor.ID, "user.create", created.Username, clientIP(r), "group="+group.Name)

	view := s.tenantUserView(created)
	view["linux"] = provisionView(s.host.Mode(), linux)
	if generated {
		view["password"] = password
		view["passwordShownOnce"] = true
	}
	writeJSON(w, http.StatusCreated, view)
}

// handleProvisionUser creates (or reconciles) the Linux account behind a panel
// account. It is the repair for an account that predates the mandatory rule, so no
// account has to stay without an OS identity.
func (s *Server) handleProvisionUser(w http.ResponseWriter, r *http.Request, actor *store.User, _ *store.Session) {
	account, err := s.store.UserByID(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Account not found")
		return
	}
	group, err := s.store.GroupByName(account.GroupName)
	if err != nil {
		writeError(w, http.StatusConflict, "no_such_group", "No such package: "+account.GroupName)
		return
	}
	result, err := s.provisionTenantAccount(r.Context(), account.Username, group)
	if err != nil {
		writeError(w, http.StatusBadGateway, "provisioning_failed", "Could not create the Linux account: "+err.Error())
		return
	}
	_ = s.store.Audit(actor.ID, "user.provision", account.Username, clientIP(r), s.host.Mode())
	writeJSON(w, http.StatusOK, map[string]any{
		"user":  s.tenantUserView(account),
		"linux": provisionView(s.host.Mode(), result),
	})
}

type updateUserRequest struct {
	Email     *string `json:"email"`
	GroupName *string `json:"groupName"`
	Status    *string `json:"status"`
}

// handleUpdateUser changes an account's email, package or status. Changing the
// package re-applies the account's quota; changing the status mirrors to the OS
// account and revokes that account's sessions.
func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request, actor *store.User, _ *store.Session) {
	account, err := s.store.UserByID(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Account not found")
		return
	}
	var req updateUserRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}

	if req.Email != nil {
		if err := s.store.SetUserEmail(account.Username, strings.TrimSpace(*req.Email)); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not save the email")
			return
		}
	}

	groupName := account.GroupName
	if req.GroupName != nil {
		groupName = strings.TrimSpace(*req.GroupName)
	}
	if groupName != account.GroupName {
		group, err := s.store.GroupByName(groupName)
		if err != nil {
			writeError(w, http.StatusConflict, "no_such_group", "No such package: "+groupName)
			return
		}
		// Moving an admin into a non-admin package is a demotion: refuse it when it
		// would leave the panel with no administrator at all.
		if account.Role == "admin" && roleForGroup(group.Name) != "admin" {
			if last, err := s.isLastAdmin(account.Username); err == nil && last {
				writeError(w, http.StatusConflict, "last_admin", "This is the only admin account; the panel would be locked out")
				return
			}
		}
		delta := map[string]int{group.Name: 1}
		if account.GroupName != "" {
			delta[account.GroupName] = -1
		}
		capacity, allocation, err := s.guardPlan(group, delta)
		if err != nil {
			writeJSON(w, http.StatusConflict, map[string]any{
				"error":    apiError{Code: "insufficient_capacity", Message: err.Error()},
				"capacity": capacity,
				"usage":    allocation,
			})
			return
		}
		if err := s.store.SetUserRole(account.Username, roleForGroup(group.Name), group.Name); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not change the package")
			return
		}
		// The package changed: reconcile the Linux account and its disk/inode quota.
		_, _ = s.provisionTenantAccount(r.Context(), account.Username, group)
	}

	if req.Status != nil {
		status := strings.TrimSpace(*req.Status)
		if status != "active" && status != "suspended" {
			writeJSON(w, http.StatusBadRequest, validationResponse(
				map[string]string{"status": "status must be active or suspended"}, "Invalid status"))
			return
		}
		if account.Username == actor.Username {
			writeError(w, http.StatusBadRequest, "self_action", "You cannot change your own status")
			return
		}
		if status != "active" && account.Role == "admin" {
			if last, err := s.isLastAdmin(account.Username); err == nil && last {
				writeError(w, http.StatusConflict, "last_admin", "This is the only admin account; the panel would be locked out")
				return
			}
		}
		if err := s.store.SetUserStatus(account.Username, status); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not change the status")
			return
		}
		if s.tenants != nil {
			if status == "active" {
				_ = s.tenants.Unlock(r.Context(), account.Username)
			} else {
				_ = s.tenants.Lock(r.Context(), account.Username)
			}
		}
		// Suspend or release the account's services with it.
		s.setTenantSitesStatus(r.Context(), account.Username, status)
	}

	_ = s.store.Audit(actor.ID, "user.update", account.Username, clientIP(r), "")
	updated, err := s.store.UserByID(account.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not reload the account")
		return
	}
	writeJSON(w, http.StatusOK, s.tenantUserView(updated))
}

// handleDeleteUser removes a panel account. An account that still owns websites or
// databases is refused with the list, so no resource is left without an owner.
func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request, actor *store.User, _ *store.Session) {
	account, err := s.store.UserByID(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Account not found")
		return
	}
	if account.Username == actor.Username {
		writeError(w, http.StatusBadRequest, "self_action", "You cannot delete your own account")
		return
	}
	if account.Role == "admin" {
		if last, err := s.isLastAdmin(account.Username); err == nil && last {
			writeError(w, http.StatusConflict, "last_admin", "This is the only admin account; the panel would be locked out")
			return
		}
	}

	sites, err := s.store.ListWebsitesByTenant(account.Username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not read the account's websites")
		return
	}
	var databases []store.Database
	for _, kind := range []string{store.KindDatabase, store.KindCache} {
		list, err := s.store.DatabasesForTenant(kind, account.Username, false)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not read the account's databases")
			return
		}
		databases = append(databases, list...)
	}
	if len(sites) > 0 || len(databases) > 0 {
		slugs := make([]string, 0, len(sites))
		for _, site := range sites {
			slugs = append(slugs, site.Slug)
		}
		aliases := make([]string, 0, len(databases))
		for _, db := range databases {
			aliases = append(aliases, db.Alias)
		}
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":     apiError{Code: "has_resources", Message: "This account still owns resources; move or delete them first"},
			"sites":     slugs,
			"databases": aliases,
		})
		return
	}

	// Remove the Linux account too, so deleting a panel account cannot leave an OS
	// account or an orphan home behind. Only when it exists — a drifted account has
	// nothing to remove — and a failure keeps the panel row, so the two stay in step.
	linux := map[string]any{"removed": false, "mode": s.host.Mode()}
	if s.tenants != nil {
		if _, ok := s.tenants.Lookup(r.Context(), account.Username); ok {
			result, err := s.tenants.Remove(r.Context(), account.Username)
			if err != nil {
				writeError(w, http.StatusBadGateway, "provisioning_failed", "Could not remove the Linux account: "+err.Error())
				return
			}
			linux["removed"] = true
			if result != nil {
				linux["home"] = result.Home
				linux["notes"] = result.Notes
			}
			_ = s.store.Audit(actor.ID, "user.remove_os", account.Username, clientIP(r), s.host.Mode())
		}
	}

	if err := s.store.DeleteUser(account.Username); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not delete the account")
		return
	}
	_ = s.store.Audit(actor.ID, "user.delete", account.Username, clientIP(r), "")
	writeJSON(w, http.StatusOK, map[string]any{"username": account.Username, "deleted": true, "linux": linux})
}

// handleResetUserPassword sets a new password for an account and signs that
// account out everywhere. The password is generated (and shown once) when the body
// does not carry one.
func (s *Server) handleResetUserPassword(w http.ResponseWriter, r *http.Request, actor *store.User, _ *store.Session) {
	account, err := s.store.UserByID(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Account not found")
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if r.ContentLength != 0 {
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
			return
		}
	}
	password := req.Password
	generated := false
	if password == "" {
		password = id.Token(12)
		generated = true
	}
	if len(password) < 12 {
		writeJSON(w, http.StatusBadRequest, validationResponse(
			map[string]string{"password": "a password must be at least 12 characters"}, "Invalid password"))
		return
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not hash the password")
		return
	}
	if _, err := s.store.SetUserPassword(account.Username, hash); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not save the password")
		return
	}
	_ = s.store.Audit(actor.ID, "user.password_reset", account.Username, clientIP(r), "every session signed out")
	out := map[string]any{"username": account.Username, "signedOutEverywhere": true}
	if generated {
		out["password"] = password
		out["passwordShownOnce"] = true
	}
	writeJSON(w, http.StatusOK, out)
}

type createGroupRequest struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Permissions map[string]bool   `json:"permissions"`
	Limits      *resources.Limits `json:"limits"`
}

// handleCreateGroup adds a new package. The capacity guard runs, but an empty
// package claims nothing until a member joins it — the real guard is at assignment.
func (s *Server) handleCreateGroup(w http.ResponseWriter, r *http.Request, actor *store.User, _ *store.Session) {
	var req createGroupRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || len(name) > 64 {
		writeJSON(w, http.StatusBadRequest, validationResponse(
			map[string]string{"name": "a package needs a name of 1–64 characters"}, "Invalid package name"))
		return
	}
	if _, err := s.store.GroupByName(name); err == nil {
		writeError(w, http.StatusConflict, "already_exists", "A package named "+name+" already exists")
		return
	}
	limits := resources.Limits{}
	if req.Limits != nil {
		limits = *req.Limits
	}
	if limits.CPUQuotaPercent < 0 || limits.MemoryMB < 0 || limits.TasksMax < 0 ||
		limits.DiskQuotaGB < 0 || limits.InodeQuota < 0 || limits.MaxSites < 0 || limits.MaxDatabases < 0 {
		writeJSON(w, http.StatusBadRequest, validationResponse(
			map[string]string{"limits": "limits cannot be negative"}, "Invalid package limits"))
		return
	}
	permissions := rbac.Permissions(req.Permissions).Normalised()
	group := &rbac.Group{Name: name, Description: strings.TrimSpace(req.Description), Permissions: permissions, Limits: limits}

	capacity, allocation, err := s.guardPlan(group, nil)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":    apiError{Code: "insufficient_capacity", Message: err.Error()},
			"capacity": capacity,
			"usage":    allocation,
		})
		return
	}
	created, err := s.store.CreateGroup(name, group.Description, permissions, limits)
	if err != nil {
		writeError(w, http.StatusConflict, "already_exists", "Could not create the package")
		return
	}
	_ = s.store.Audit(actor.ID, "group.create", name, clientIP(r), limits.Describe())
	writeJSON(w, http.StatusCreated, created)
}

// handleDeleteGroup removes a package. A built-in package and a package that still
// has members are both refused.
func (s *Server) handleDeleteGroup(w http.ResponseWriter, r *http.Request, actor *store.User, _ *store.Session) {
	name := r.PathValue("name")
	group, err := s.store.GroupByName(name)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Package not found")
		return
	}
	if group.IsSystem {
		writeError(w, http.StatusForbidden, "forbidden", "A built-in package cannot be deleted")
		return
	}
	members, err := s.store.CountUsersByGroup(name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not count the package's members")
		return
	}
	if members > 0 {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":   apiError{Code: "has_members", Message: fmt.Sprintf("This package still has %d member(s); move them first", members)},
			"members": members,
		})
		return
	}
	if err := s.store.DeleteGroup(name); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not delete the package")
		return
	}
	_ = s.store.Audit(actor.ID, "group.delete", name, clientIP(r), "")
	writeJSON(w, http.StatusOK, map[string]any{"name": name, "deleted": true})
}
