package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/webserver"
)

// routeSpecsFor converts stored routes into the renderer's shape. A route that cannot be
// rendered (empty path/upstream) is skipped rather than producing a broken vhost.
func (s *Server) routeSpecsFor(slug string) []webserver.RouteSpec {
	routes, err := s.store.ListWebsiteRoutes(slug)
	if err != nil {
		return nil
	}
	out := make([]webserver.RouteSpec, 0, len(routes))
	for _, route := range routes {
		if strings.TrimSpace(route.Path) == "" || strings.TrimSpace(route.Upstream) == "" {
			continue
		}
		out = append(out, webserver.RouteSpec{
			Path:        route.Path,
			Upstream:    route.Upstream,
			Websocket:   route.Websocket,
			StripPrefix: route.StripPrefix,
		})
	}
	return out
}

type routePayload struct {
	Path        string `json:"path"`
	Upstream    string `json:"upstream"`
	Description string `json:"description"`
	Websocket   *bool  `json:"websocket"`
	StripPrefix *bool  `json:"stripPrefix"`
}

func normalizeRoute(payload *routePayload) error {
	payload.Path = strings.TrimSpace(strings.TrimSuffix(payload.Path, "*"))
	payload.Upstream = strings.TrimRight(strings.TrimSpace(payload.Upstream), "/")
	payload.Description = strings.TrimSpace(payload.Description)

	if payload.Path == "" || !strings.HasPrefix(payload.Path, "/") || payload.Path == "/" {
		return fmt.Errorf("path must start with / and cannot be the root route")
	}
	if strings.Contains(payload.Path, "..") || strings.ContainsAny(payload.Path, " \t\r\n") || len(payload.Path) > 200 {
		return fmt.Errorf("path must be a clean prefix such as /api, without spaces or ..")
	}
	parsed, err := url.Parse(payload.Upstream)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return fmt.Errorf("upstream must be an http:// or https:// URL with a host")
	}
	return nil
}

func (s *Server) handleListWebsiteRoutes(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}
	routes, err := s.store.ListWebsiteRoutes(site.Slug)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not list routes")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": routes})
}

func (s *Server) handleCreateWebsiteRoute(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	var payload routePayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Unusable JSON body")
		return
	}
	if err := normalizeRoute(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "validation_error", err.Error())
		return
	}
	existing, _ := s.store.ListWebsiteRoutes(site.Slug)
	for _, route := range existing {
		if strings.EqualFold(route.Path, payload.Path) {
			writeError(w, http.StatusConflict, "route_exists", "A route with this path already exists")
			return
		}
	}

	route := &store.WebsiteRoute{
		WebsiteSlug: site.Slug,
		Path:        payload.Path,
		Upstream:    payload.Upstream,
		Description: payload.Description,
		Websocket:   payload.Websocket == nil || *payload.Websocket,
		StripPrefix: payload.StripPrefix == nil || *payload.StripPrefix,
	}
	if err := s.store.CreateWebsiteRoute(route); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not save the route")
		return
	}
	if err := s.applyVhost(r, site); err != nil {
		writeError(w, http.StatusInternalServerError, "service_error", "Route saved, but the vhost could not be reloaded: "+err.Error())
		return
	}
	_ = s.store.Audit(user.ID, "website.route_create", site.Slug, clientIP(r), route.Path+" -> "+route.Upstream)
	writeJSON(w, http.StatusCreated, route)
}

func (s *Server) handleUpdateWebsiteRoute(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}
	route, err := s.store.WebsiteRouteByID(site.Slug, r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Route not found")
		return
	}

	var payload routePayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Unusable JSON body")
		return
	}
	if payload.Path == "" {
		payload.Path = route.Path
	}
	if payload.Upstream == "" {
		payload.Upstream = route.Upstream
	}
	if payload.Description == "" {
		payload.Description = route.Description
	}
	if err := normalizeRoute(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "validation_error", err.Error())
		return
	}
	if payload.Websocket != nil {
		route.Websocket = *payload.Websocket
	}
	if payload.StripPrefix != nil {
		route.StripPrefix = *payload.StripPrefix
	}
	route.Path = payload.Path
	route.Upstream = payload.Upstream
	route.Description = payload.Description

	if err := s.store.UpdateWebsiteRoute(route); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not save the route")
		return
	}
	if err := s.applyVhost(r, site); err != nil {
		writeError(w, http.StatusInternalServerError, "service_error", "Route saved, but the vhost could not be reloaded: "+err.Error())
		return
	}
	_ = s.store.Audit(user.ID, "website.route_update", site.Slug, clientIP(r), route.Path+" -> "+route.Upstream)
	writeJSON(w, http.StatusOK, route)
}

func (s *Server) handleDeleteWebsiteRoute(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}
	if err := s.store.DeleteWebsiteRoute(site.Slug, r.PathValue("id")); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not delete the route")
		return
	}
	if err := s.applyVhost(r, site); err != nil {
		writeError(w, http.StatusInternalServerError, "service_error", "Route deleted, but the vhost could not be reloaded: "+err.Error())
		return
	}
	_ = s.store.Audit(user.ID, "website.route_delete", site.Slug, clientIP(r), r.PathValue("id"))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
