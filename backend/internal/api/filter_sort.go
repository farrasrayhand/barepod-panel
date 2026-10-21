package api

import (
	"net/http"
	"sort"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// listQuery is the shared collection query: ?owner=&sort_by=&order=.
// Filtering by owner is an admin tool; a tenant is already scoped to its own rows,
// so the parameter is ignored for non-admins rather than letting it widen the query.
type listQuery struct {
	Owner  string
	SortBy string
	Order  string
}

func parseListQuery(r *http.Request) listQuery {
	order := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("order")))
	if order != "desc" {
		order = "asc"
	}
	return listQuery{
		Owner:  strings.ToLower(strings.TrimSpace(r.URL.Query().Get("owner"))),
		SortBy: strings.ToLower(strings.TrimSpace(r.URL.Query().Get("sort_by"))),
		Order:  order,
	}
}

// websiteSortFields is what the API actually knows how to order by. `size` is not
// here on purpose: a website is not a record with a byte count, and pretending to
// sort by one would be a lie.
var websiteSortFields = map[string]bool{
	"owner": true, "name": true, "status": true, "runtime": true, "engine": true,
}

var databaseSortFields = map[string]bool{
	"owner": true, "name": true, "status": true, "engine": true, "size": true,
}

func (q listQuery) validFor(fields map[string]bool) bool {
	if q.SortBy == "" {
		return true
	}
	return fields[q.SortBy]
}

func filterWebsitesByOwner(items []store.Website, owner string) []store.Website {
	if owner == "" {
		return items
	}
	out := items[:0]
	for _, item := range items {
		if strings.EqualFold(item.TenantUser, owner) {
			out = append(out, item)
		}
	}
	return out
}

func sortWebsites(items []store.Website, q listQuery) {
	if q.SortBy == "" {
		return
	}
	less := func(a, b store.Website) bool {
		switch q.SortBy {
		case "owner":
			return strings.ToLower(a.TenantUser) < strings.ToLower(b.TenantUser)
		case "status":
			return strings.ToLower(a.Status) < strings.ToLower(b.Status)
		case "runtime":
			return strings.ToLower(a.Runtime) < strings.ToLower(b.Runtime)
		case "engine":
			return strings.ToLower(a.WebServer) < strings.ToLower(b.WebServer)
		default: // name
			return strings.ToLower(a.Slug) < strings.ToLower(b.Slug)
		}
	}
	sort.SliceStable(items, func(i, j int) bool {
		if q.Order == "desc" {
			return less(items[j], items[i])
		}
		return less(items[i], items[j])
	})
}

func filterDatabasesByOwner(items []store.Database, owner string) []store.Database {
	if owner == "" {
		return items
	}
	out := items[:0]
	for _, item := range items {
		if strings.EqualFold(item.TenantUser, owner) {
			out = append(out, item)
		}
	}
	return out
}

func sortDatabases(items []store.Database, q listQuery) {
	if q.SortBy == "" {
		return
	}
	less := func(a, b store.Database) bool {
		switch q.SortBy {
		case "owner":
			return strings.ToLower(a.TenantUser) < strings.ToLower(b.TenantUser)
		case "status":
			return strings.ToLower(a.Status) < strings.ToLower(b.Status)
		case "engine":
			return strings.ToLower(a.Engine) < strings.ToLower(b.Engine)
		case "size":
			return a.SizeBytes < b.SizeBytes
		default: // name
			nameA := a.Alias
			if nameA == "" {
				nameA = a.Name
			}
			nameB := b.Alias
			if nameB == "" {
				nameB = b.Name
			}
			return strings.ToLower(nameA) < strings.ToLower(nameB)
		}
	}
	sort.SliceStable(items, func(i, j int) bool {
		if q.Order == "desc" {
			return less(items[j], items[i])
		}
		return less(items[i], items[j])
	})
}
