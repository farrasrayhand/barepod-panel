package store

import (
	"database/sql"
	"errors"

	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
)

// WebsiteRoute is one path prefix forwarded to its own upstream, rendered into the site's vhost.
// Path "/" is deliberately not a route: it is the site's primary upstream, which the website row
// already owns.
type WebsiteRoute struct {
	ID          string `json:"id"`
	WebsiteSlug string `json:"websiteSlug"`
	Path        string `json:"path"`
	Upstream    string `json:"upstream"`
	Description string `json:"description,omitempty"`
	Websocket   bool   `json:"websocket"`
	StripPrefix bool   `json:"stripPrefix"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt,omitempty"`
}

const websiteRouteColumns = `id, website_slug, path, upstream, description, websocket, strip_prefix, created_at, updated_at`

func scanWebsiteRoute(row interface{ Scan(...any) error }) (*WebsiteRoute, error) {
	var route WebsiteRoute
	err := row.Scan(&route.ID, &route.WebsiteSlug, &route.Path, &route.Upstream, &route.Description,
		&route.Websocket, &route.StripPrefix, &route.CreatedAt, &route.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &route, nil
}

// ListWebsiteRoutes returns a site's routes ordered by path so the vhost is deterministic.
func (s *Store) ListWebsiteRoutes(slug string) ([]WebsiteRoute, error) {
	rows, err := s.DB.Query(
		`SELECT `+websiteRouteColumns+` FROM website_routes WHERE website_slug = ? ORDER BY path ASC`, slug)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []WebsiteRoute{}
	for rows.Next() {
		route, err := scanWebsiteRoute(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *route)
	}
	return out, rows.Err()
}

// WebsiteRouteByID loads one route, scoped to its site.
func (s *Store) WebsiteRouteByID(slug, id string) (*WebsiteRoute, error) {
	return scanWebsiteRoute(s.DB.QueryRow(
		`SELECT `+websiteRouteColumns+` FROM website_routes WHERE website_slug = ? AND id = ?`, slug, id))
}

// CreateWebsiteRoute inserts a route and fills its generated id/timestamps.
func (s *Store) CreateWebsiteRoute(route *WebsiteRoute) error {
	if route.ID == "" {
		route.ID = id.New()
	}
	if route.CreatedAt == "" {
		route.CreatedAt = now()
	}
	_, err := s.DB.Exec(
		`INSERT INTO website_routes (id, website_slug, path, upstream, description, websocket, strip_prefix, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		route.ID, route.WebsiteSlug, route.Path, route.Upstream, route.Description,
		route.Websocket, route.StripPrefix, route.CreatedAt, route.UpdatedAt,
	)
	return err
}

// UpdateWebsiteRoute changes a route's target and flags.
func (s *Store) UpdateWebsiteRoute(route *WebsiteRoute) error {
	route.UpdatedAt = now()
	_, err := s.DB.Exec(
		`UPDATE website_routes SET path = ?, upstream = ?, description = ?, websocket = ?, strip_prefix = ?, updated_at = ?
		 WHERE website_slug = ? AND id = ?`,
		route.Path, route.Upstream, route.Description, route.Websocket, route.StripPrefix, route.UpdatedAt,
		route.WebsiteSlug, route.ID,
	)
	return err
}

// DeleteWebsiteRoute removes one route from a site.
func (s *Store) DeleteWebsiteRoute(slug, id string) error {
	_, err := s.DB.Exec(`DELETE FROM website_routes WHERE website_slug = ? AND id = ?`, slug, id)
	return err
}
