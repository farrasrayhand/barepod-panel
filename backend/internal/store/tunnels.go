package store

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
)

// GetCloudflareTunnel retrieves the tunnel record for the given tenant user.
func (s *Store) GetCloudflareTunnel(tenantUser string) (*CloudflareTunnel, error) {
	row := s.DB.QueryRow(
		`SELECT id, tenant_user, tunnel_name, token, api_token, account_id, tunnel_id, created_at, updated_at
		 FROM cloudflare_tunnels WHERE tenant_user = ?`,
		tenantUser,
	)
	var t CloudflareTunnel
	err := row.Scan(&t.ID, &t.TenantUser, &t.TunnelName, &t.Token, &t.ApiToken, &t.AccountID, &t.TunnelID, &t.CreatedAt, &t.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// UpsertCloudflareTunnel creates or updates the tunnel token and metadata for a tenant.
func (s *Store) UpsertCloudflareTunnel(tenantUser, tunnelName, token, apiToken, accountID, tunnelID string) (*CloudflareTunnel, error) {
	t, err := s.GetCloudflareTunnel(tenantUser)
	nowTs := now()
	if errors.Is(err, ErrNotFound) {
		if tunnelName == "" {
			tunnelName = tenantUser + "-tunnel"
		}
		newTunnel := &CloudflareTunnel{
			ID:         id.New(),
			TenantUser: tenantUser,
			TunnelName: tunnelName,
			Token:      token,
			ApiToken:   apiToken,
			AccountID:  accountID,
			TunnelID:   tunnelID,
			CreatedAt:  nowTs,
			UpdatedAt:  nowTs,
		}
		_, err := s.DB.Exec(
			`INSERT INTO cloudflare_tunnels (id, tenant_user, tunnel_name, token, api_token, account_id, tunnel_id, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			newTunnel.ID, newTunnel.TenantUser, newTunnel.TunnelName, newTunnel.Token, newTunnel.ApiToken, newTunnel.AccountID, newTunnel.TunnelID, newTunnel.CreatedAt, newTunnel.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		return newTunnel, nil
	}
	if err != nil {
		return nil, err
	}

	if tunnelName == "" {
		tunnelName = t.TunnelName
	}
	if tunnelName == "" {
		tunnelName = tenantUser + "-tunnel"
	}
	if token == "" && t.Token != "" {
		token = t.Token
	}
	if apiToken == "" && t.ApiToken != "" {
		apiToken = t.ApiToken
	}
	if accountID == "" && t.AccountID != "" {
		accountID = t.AccountID
	}
	if tunnelID == "" && t.TunnelID != "" {
		tunnelID = t.TunnelID
	}

	_, err = s.DB.Exec(
		`UPDATE cloudflare_tunnels SET tunnel_name = ?, token = ?, api_token = ?, account_id = ?, tunnel_id = ?, updated_at = ? WHERE tenant_user = ?`,
		tunnelName, token, apiToken, accountID, tunnelID, nowTs, tenantUser,
	)
	if err != nil {
		return nil, err
	}
	t.TunnelName = tunnelName
	t.Token = token
	t.ApiToken = apiToken
	t.AccountID = accountID
	t.TunnelID = tunnelID
	t.UpdatedAt = nowTs
	return t, nil
}

// SetCloudflareApiToken updates only the Cloudflare Management API Token for a tenant.
func (s *Store) SetCloudflareApiToken(tenantUser, apiToken string) error {
	t, err := s.GetCloudflareTunnel(tenantUser)
	if errors.Is(err, ErrNotFound) {
		_, err := s.UpsertCloudflareTunnel(tenantUser, tenantUser+"-tunnel", "", apiToken, "", "")
		return err
	}
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(
		`UPDATE cloudflare_tunnels SET api_token = ?, updated_at = ? WHERE tenant_user = ?`,
		apiToken, now(), tenantUser,
	)
	_ = t
	return err
}

// ListCloudflareTunnelRoutes retrieves all ingress routes for a tenant.
func (s *Store) ListCloudflareTunnelRoutes(tenantUser string) ([]CloudflareTunnelRoute, error) {
	rows, err := s.DB.Query(
		`SELECT id, tenant_user, hostname, service, app_name, status, created_at
		 FROM cloudflare_tunnel_routes WHERE tenant_user = ? ORDER BY created_at DESC`,
		tenantUser,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var routes []CloudflareTunnelRoute
	for rows.Next() {
		var r CloudflareTunnelRoute
		if err := rows.Scan(&r.ID, &r.TenantUser, &r.Hostname, &r.Service, &r.AppName, &r.Status, &r.CreatedAt); err != nil {
			return nil, err
		}
		routes = append(routes, r)
	}
	if routes == nil {
		routes = []CloudflareTunnelRoute{}
	}
	return routes, nil
}

// CreateCloudflareTunnelRoute adds or updates an ingress hostname route for a tenant.
func (s *Store) CreateCloudflareTunnelRoute(tenantUser, hostname, service, appName string) (*CloudflareTunnelRoute, error) {
	hostname = strings.ToLower(strings.TrimSpace(hostname))
	service = strings.TrimSpace(service)
	appName = strings.TrimSpace(appName)
	if appName == "" {
		appName = "BarePod App"
	}

	// Check if already exists for this tenant
	var existingID string
	err := s.DB.QueryRow(`SELECT id FROM cloudflare_tunnel_routes WHERE tenant_user = ? AND hostname = ?`, tenantUser, hostname).Scan(&existingID)
	if err == nil && existingID != "" {
		_, err := s.DB.Exec(
			`UPDATE cloudflare_tunnel_routes SET service = ?, app_name = ? WHERE id = ?`,
			service, appName, existingID,
		)
		if err != nil {
			return nil, err
		}
		return &CloudflareTunnelRoute{
			ID:         existingID,
			TenantUser: tenantUser,
			Hostname:   hostname,
			Service:    service,
			AppName:    appName,
			Status:     "Healthy",
			CreatedAt:  now(),
		}, nil
	}

	r := &CloudflareTunnelRoute{
		ID:         id.New(),
		TenantUser: tenantUser,
		Hostname:   hostname,
		Service:    service,
		AppName:    appName,
		Status:     "Healthy",
		CreatedAt:  now(),
	}
	_, err = s.DB.Exec(
		`INSERT INTO cloudflare_tunnel_routes (id, tenant_user, hostname, service, app_name, status, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.TenantUser, r.Hostname, r.Service, r.AppName, r.Status, r.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return r, nil
}

// DeleteCloudflareTunnelRoute removes a route by ID or hostname.
func (s *Store) DeleteCloudflareTunnelRoute(tenantUser, idOrHostname string) error {
	_, err := s.DB.Exec(
		`DELETE FROM cloudflare_tunnel_routes WHERE tenant_user = ? AND (id = ? OR hostname = ?)`,
		tenantUser, idOrHostname, idOrHostname,
	)
	return err
}

// UpdateCloudflareTunnelRoute updates an existing route by its ID.
func (s *Store) UpdateCloudflareTunnelRoute(tenantUser, id, hostname, service, appName string) (*CloudflareTunnelRoute, error) {
	hostname = strings.ToLower(strings.TrimSpace(hostname))
	service = strings.TrimSpace(service)
	appName = strings.TrimSpace(appName)
	if appName == "" {
		appName = "BarePod App"
	}
	_, err := s.DB.Exec(
		`UPDATE cloudflare_tunnel_routes SET hostname = ?, service = ?, app_name = ? WHERE tenant_user = ? AND id = ?`,
		hostname, service, appName, tenantUser, id,
	)
	if err != nil {
		return nil, err
	}
	return &CloudflareTunnelRoute{
		ID:         id,
		TenantUser: tenantUser,
		Hostname:   hostname,
		Service:    service,
		AppName:    appName,
		Status:     "Healthy",
		CreatedAt:  now(),
	}, nil
}

// DeleteCloudflareTunnel deletes the stored Cloudflare tunnel credentials for a tenant.
func (s *Store) DeleteCloudflareTunnel(tenantUser string) error {
	_, err := s.DB.Exec(`DELETE FROM cloudflare_tunnels WHERE tenant_user = ?`, tenantUser)
	return err
}

// UpdateCloudflareTunnelRouteHostname renames a tunnel route hostname for a tenant.
func (s *Store) UpdateCloudflareTunnelRouteHostname(tenantUser, oldHostname, newHostname string) error {
	oldHostname = strings.ToLower(strings.TrimSpace(oldHostname))
	newHostname = strings.ToLower(strings.TrimSpace(newHostname))
	if oldHostname == "" || newHostname == "" {
		return nil
	}
	_, err := s.DB.Exec(
		`UPDATE cloudflare_tunnel_routes SET hostname = ? WHERE tenant_user = ? AND hostname = ?`,
		newHostname, tenantUser, oldHostname,
	)
	return err
}


