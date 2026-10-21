package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/cloudflare"
	"github.com/farrasrayhand/barepod-panel/backend/internal/ssl"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// handleListDomains returns domains visible to the user (filtered by tenant if non-admin).
func (s *Server) handleListDomains(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	websiteSlug := r.URL.Query().Get("websiteSlug")
	if websiteSlug != "" {
		site, err := s.store.WebsiteBySlug(websiteSlug)
		if err != nil || !canManageSite(user, site) {
			writeError(w, http.StatusNotFound, "not_found", "Website not found")
			return
		}
		items, err := s.store.ListDomainsForSite(websiteSlug)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Failed to list domains")
			return
		}
		s.enrichDomains(items)
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
		return
	}

	tenantFilter := ""
	if user.Role != "admin" {
		tenantFilter = user.Username
	}

	items, err := s.store.ListDomains(tenantFilter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Failed to list domains")
		return
	}
	s.enrichDomains(items)
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

type addDomainRequest struct {
	WebsiteSlug string `json:"websiteSlug"`
	Domain      string `json:"domain"`
	// RoutingMode is cloudflare or direct; empty keeps the historical behaviour (no route).
	RoutingMode string `json:"routingMode,omitempty"`
}

// handleAddDomain registers an alias domain for a website and updates its web server vhost.
func (s *Server) handleAddDomain(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var req addDomainRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Malformed JSON request")
		return
	}

	req.WebsiteSlug = strings.TrimSpace(req.WebsiteSlug)
	req.Domain = strings.ToLower(strings.TrimSpace(req.Domain))

	if req.WebsiteSlug == "" {
		writeError(w, http.StatusBadRequest, "missing_website", "Website slug is required")
		return
	}
	if req.Domain == "" || strings.Contains(req.Domain, " ") || strings.Contains(req.Domain, "/") || !strings.Contains(req.Domain, ".") {
		writeError(w, http.StatusBadRequest, "invalid_domain", "Please provide a valid fully-qualified domain name (e.g. app.example.com)")
		return
	}
	req.RoutingMode = strings.ToLower(strings.TrimSpace(req.RoutingMode))
	if req.RoutingMode != "" && req.RoutingMode != "cloudflare" && req.RoutingMode != "direct" {
		writeError(w, http.StatusBadRequest, "invalid_routing_mode", "routingMode must be cloudflare or direct")
		return
	}

	site, err := s.store.WebsiteBySlug(req.WebsiteSlug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	existing, _ := s.store.GetDomainByName(req.Domain)
	if existing != nil {
		writeError(w, http.StatusConflict, "domain_exists", fmt.Sprintf("Domain '%s' is already registered to website '%s'", req.Domain, existing.WebsiteSlug))
		return
	}

	d, err := s.store.CreateDomain(site.Slug, req.Domain, false)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Failed to register domain: "+err.Error())
		return
	}

	// Reapply vhost to include the new alias
	if err := s.applyVhost(r, site); err != nil {
		_ = s.store.DeleteDomain(d.ID)
		writeError(w, http.StatusInternalServerError, "webserver_error", "Failed to apply domain to web server: "+err.Error())
		return
	}

	if req.RoutingMode != "" {
		if err := s.applyDomainRouting(r.Context(), site, d.Domain, req.RoutingMode); err != nil {
			_ = s.store.DeleteDomain(d.ID)
			_ = s.applyVhost(r, site)
			writeError(w, http.StatusBadGateway, "routing_sync_failed", err.Error())
			return
		}
	}

	_ = s.store.Audit(user.ID, "domain.add", req.Domain, clientIP(r), "site="+site.Slug+" routing="+req.RoutingMode)
	s.enrichDomain(d)
	writeJSON(w, http.StatusCreated, d)
}

type updateDomainRequest struct {
	Domain string `json:"domain"`
	// WebsiteSlug moves the domain to another website; empty keeps it where it is.
	WebsiteSlug string `json:"websiteSlug,omitempty"`
	// RoutingMode switches the domain between the tenant's Cloudflare tunnel and a direct address.
	RoutingMode string `json:"routingMode,omitempty"`
}

// handleUpdateDomain edits the domain name of an existing domain (primary or alias) and reapplies the vhost.
func (s *Server) handleUpdateDomain(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	id := r.PathValue("id")
	d, err := s.store.GetDomain(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Domain not found")
		return
	}

	site, err := s.store.WebsiteBySlug(d.WebsiteSlug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	var req updateDomainRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Malformed JSON request")
		return
	}

	req.RoutingMode = strings.ToLower(strings.TrimSpace(req.RoutingMode))
	if req.RoutingMode != "" && req.RoutingMode != "cloudflare" && req.RoutingMode != "direct" {
		writeError(w, http.StatusBadRequest, "invalid_routing_mode", "routingMode must be cloudflare or direct")
		return
	}

	newDomain := strings.ToLower(strings.TrimSpace(req.Domain))
	if newDomain == "" || strings.Contains(newDomain, " ") || strings.Contains(newDomain, "/") || !strings.Contains(newDomain, ".") {
		writeError(w, http.StatusBadRequest, "invalid_domain", "Please provide a valid fully-qualified domain name (e.g. app.example.com)")
		return
	}

	// A domain may also move to another website. Only an alias can: the primary domain *is* the
	// website's identity, so moving it would leave that website without one.
	targetSlug := strings.TrimSpace(req.WebsiteSlug)
	if targetSlug == "" {
		targetSlug = d.WebsiteSlug
	}
	websiteChanged := targetSlug != d.WebsiteSlug
	var target *store.Website
	if websiteChanged {
		if d.IsPrimary {
			writeError(w, http.StatusConflict, "primary_domain",
				"This is the website's primary domain, so it belongs to that website. Rename it here, or add it to the other website as an alias.")
			return
		}
		t, err := s.store.WebsiteBySlug(targetSlug)
		if err != nil || !canManageSite(user, t) {
			writeError(w, http.StatusNotFound, "not_found", "Target website not found")
			return
		}
		target = t
	}

	if newDomain == strings.ToLower(d.Domain) && !websiteChanged {
		writeJSON(w, http.StatusOK, d)
		return
	}

	// Check if domain is already in use by another website/domain
	if existing, _ := s.store.GetDomainByName(newDomain); existing != nil && existing.ID != d.ID {
		writeError(w, http.StatusConflict, "domain_exists", fmt.Sprintf("Domain '%s' is already registered to website '%s'", newDomain, existing.WebsiteSlug))
		return
	}

	oldDomain := d.Domain
	renamed := newDomain != oldDomain

	if renamed {
		if d.IsPrimary {
			if err := s.store.UpdateWebsiteDomain(site.Slug, newDomain); err != nil {
				writeError(w, http.StatusInternalServerError, "internal", "Failed to update website domain: "+err.Error())
				return
			}
			site.Domain = newDomain
		} else {
			if err := s.store.UpdateDomainName(d.ID, newDomain); err != nil {
				writeError(w, http.StatusInternalServerError, "internal", "Failed to update alias domain: "+err.Error())
				return
			}
		}
	}

	if websiteChanged {
		if err := s.store.SetDomainWebsite(d.ID, target.Slug); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Failed to move the domain: "+err.Error())
			return
		}
	}

	// Both websites' vhosts change when a domain moves: the one losing it and the one gaining it.
	if err := s.applyVhost(r, site); err != nil {
		writeError(w, http.StatusInternalServerError, "webserver_error", "Failed to apply updated domain to web server: "+err.Error())
		return
	}
	if websiteChanged {
		if err := s.applyVhost(r, target); err != nil {
			writeError(w, http.StatusInternalServerError, "webserver_error", "Failed to apply the domain to the target website: "+err.Error())
			return
		}
	}

	// The tunnel route follows the domain, whether it was renamed or handed to another tenant.
	if websiteChanged {
		_ = s.store.MoveCloudflareTunnelRoute(site.TenantUser, target.TenantUser, oldDomain, newDomain)
	} else if renamed {
		// If a Cloudflare tunnel route exists for the old domain, automatically update it.
		go s.migrateTunnelRouteForDomain(site.TenantUser, oldDomain, newDomain)
	}

	routingSite := site
	if websiteChanged && target != nil {
		routingSite = target
	}
	if req.RoutingMode != "" {
		if err := s.applyDomainRouting(r.Context(), routingSite, newDomain, req.RoutingMode); err != nil {
			writeError(w, http.StatusBadGateway, "routing_sync_failed", err.Error())
			return
		}
	}

	_ = s.store.Audit(user.ID, "domain.update", newDomain, clientIP(r), fmt.Sprintf("site=%s old=%s isPrimary=%v movedTo=%s routing=%s", site.Slug, oldDomain, d.IsPrimary, targetSlug, req.RoutingMode))

	updated, _ := s.store.GetDomain(id)
	s.enrichDomain(updated)
	writeJSON(w, http.StatusOK, updated)
}

// handleUpdateWebsiteDomain updates the primary domain of a website directly by website slug.
func (s *Server) handleUpdateWebsiteDomain(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	domains, err := s.store.ListDomainsForSite(slug)
	if err != nil || len(domains) == 0 {
		writeError(w, http.StatusNotFound, "not_found", "No domains found for website")
		return
	}

	var primaryID string
	for _, dom := range domains {
		if dom.IsPrimary {
			primaryID = dom.ID
			break
		}
	}
	if primaryID == "" {
		primaryID = domains[0].ID
	}

	r.SetPathValue("id", primaryID)
	s.handleUpdateDomain(w, r, user, nil)
}

func (s *Server) migrateTunnelRouteForDomain(tenantUser, oldDomain, newDomain string) {
	if tenantUser == "" || oldDomain == "" || newDomain == "" {
		return
	}
	_ = s.store.UpdateCloudflareTunnelRouteHostname(tenantUser, oldDomain, newDomain)

	// If Cloudflare API token is configured, also sync to Cloudflare Zero Trust
	tunnel, err := s.store.GetCloudflareTunnel(tenantUser)
	if err == nil && tunnel != nil && tunnel.ApiToken != "" && tunnel.AccountID != "" && tunnel.TunnelID != "" {
		cf := cloudflare.NewClient(tunnel.ApiToken, tunnel.AccountID, tunnel.TunnelID)
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = cf.DeleteHostname(ctx, oldDomain)
		_ = cf.AddIngressRule(ctx, newDomain, "http://127.0.0.1:80", false)
	}
}

// enrichDomain fills API-only fields: the owning tenant and whether an actual Cloudflare
// tunnel route exists. Keeping this computed avoids a second source of truth in the DB.
func (s *Server) enrichDomain(d *store.WebsiteDomain) {
	if d == nil {
		return
	}
	if site, err := s.store.WebsiteBySlug(d.WebsiteSlug); err == nil && site != nil {
		d.TenantUser = site.TenantUser
	}
	routes, err := s.store.ListTunnelRoutesByHostname(d.Domain)
	if err == nil && len(routes) > 0 {
		d.RoutingMode = "cloudflare"
	} else {
		d.RoutingMode = "direct"
	}
}

func (s *Server) enrichDomains(items []*store.WebsiteDomain) {
	for _, d := range items {
		s.enrichDomain(d)
	}
}

// applyDomainRouting performs the actual Cloudflare work behind the routing switch. A
// direct domain has no ingress rule or DNS CNAME; a Cloudflare domain is added to the
// owning tenant's tunnel with the site's edge address.
func (s *Server) applyDomainRouting(ctx context.Context, site *store.Website, domain, mode string) error {
	if site == nil {
		return fmt.Errorf("website not found")
	}
	domain = strings.ToLower(strings.TrimSpace(domain))
	mode = strings.ToLower(strings.TrimSpace(mode))
	switch mode {
	case "cloudflare":
		tunnel, err := s.store.GetCloudflareTunnel(site.TenantUser)
		if err != nil || tunnel == nil || tunnel.ApiToken == "" || tunnel.AccountID == "" || tunnel.TunnelID == "" {
			return fmt.Errorf("Cloudflare Tunnel is not configured for tenant %s; connect it first", site.TenantUser)
		}
		if _, err := s.store.CreateCloudflareTunnelRoute(site.TenantUser, domain, "http://127.0.0.1:80", site.Slug); err != nil {
			return fmt.Errorf("save tunnel route: %w", err)
		}
		cf := cloudflare.NewClient(tunnel.ApiToken, tunnel.AccountID, tunnel.TunnelID)
		if err := cf.AddIngressRule(ctx, domain, "http://127.0.0.1:80", false); err != nil {
			// Do not leave a local route claiming a hostname Cloudflare refused.
			_ = s.store.DeleteTunnelRoutesByHostname(domain)
			return fmt.Errorf("sync Cloudflare route: %w", err)
		}
	case "direct":
		_ = s.store.DeleteTunnelRoutesByHostname(domain)
		if cf := s.cloudflareClientFor(site.TenantUser); cf != nil {
			_ = cf.DeleteHostname(ctx, domain)
		}
	default:
		return fmt.Errorf("routingMode must be cloudflare or direct")
	}
	// The Apps page shows a site-level badge; keep it in step with the primary hostname.
	if strings.EqualFold(domain, site.Domain) {
		_ = s.store.SetWebsiteTunnelEnabled(site.Slug, mode == "cloudflare")
	}
	return nil
}

// handleDeleteDomain removes an alias domain and reloads the web server.
func (s *Server) handleDeleteDomain(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	id := r.PathValue("id")
	d, err := s.store.GetDomain(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Domain not found")
		return
	}

	site, err := s.store.WebsiteBySlug(d.WebsiteSlug)
	if err != nil {
		if err == store.ErrNotFound {
			// Orphaned domain whose website was already deleted; allow deleting the orphan
			_ = s.store.DeleteDomain(id)
			_ = s.store.Audit(user.ID, "domain.delete_orphan", d.Domain, clientIP(r), "orphan_site="+d.WebsiteSlug)
			writeJSON(w, http.StatusOK, map[string]any{"status": "deleted", "id": id, "domain": d.Domain})
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", "Failed to retrieve website: "+err.Error())
		return
	}

	if !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	if d.IsPrimary {
		writeError(w, http.StatusBadRequest, "primary_domain", "Cannot delete the primary domain of a website. Change the primary domain first.")
		return
	}

	if err := s.store.DeleteDomain(id); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Failed to delete domain")
		return
	}

	// Reapply vhost without the removed alias
	_ = s.applyVhost(r, site)

	// Removing a domain takes its public hostname out of Cloudflare as well: the route row (when one
	// exists) and, if it is not tracked, the ingress rule it left behind.
	s.purgeHostnames(r.Context(), user.Username, site.TenantUser, d.Domain)

	_ = s.store.Audit(user.ID, "domain.delete", d.Domain, clientIP(r), "site="+site.Slug)
	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted", "id": id, "domain": d.Domain})
}

type issueSSLRequest struct {
	ForceHTTPS bool   `json:"forceHTTPS"`
	HSTS       bool   `json:"hsts"`
	Email      string `json:"email"`
	Provider   string `json:"provider"` // "letsencrypt" | "self_signed" | "auto"
}

// letsEncryptContact is the address certbot should use: the one the request named, or the panel-wide
// default set on the settings screen.
func (s *Server) letsEncryptContact(requested string) string {
	if contact := strings.TrimSpace(requested); contact != "" {
		return contact
	}
	contact, _ := s.store.PanelSetting(letsEncryptEmailKey)
	return contact
}

// handleIssueSSL provisions an SSL certificate via Let's Encrypt (with preflight check) or self-signed.
func (s *Server) handleIssueSSL(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	id := r.PathValue("id")
	d, err := s.store.GetDomain(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Domain not found")
		return
	}

	site, err := s.store.WebsiteBySlug(d.WebsiteSlug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	var req issueSSLRequest
	req.ForceHTTPS = true
	req.Provider = "auto"
	_ = json.NewDecoder(r.Body).Decode(&req)

	var info *ssl.CertInfo
	var provider string
	var warning string

	sslDir := s.host.SSLDirFor()
	if req.Provider == "self_signed" {
		certPath := filepath.Join(sslDir, d.Domain, "fullchain.pem")
		keyPath := filepath.Join(sslDir, d.Domain, "privkey.pem")
		info, err = ssl.GenerateSelfSigned(d.Domain, nil, certPath, keyPath)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "ssl_error", "Failed to generate self-signed certificate: "+err.Error())
			return
		}
		provider = "self_signed"
	} else {
		// Auto / Let's Encrypt: check DNS resolution first
		ip, resolved, dnsErr := ssl.PreflightDNS(d.Domain)
		if !resolved {
			if req.Provider == "letsencrypt" {
				writeError(w, http.StatusBadRequest, "dns_unresolved",
					fmt.Sprintf("DNS pre-flight check failed for %s: %v. Please point your domain DNS A-record to this server's public IP before requesting Let's Encrypt, or select Self-Signed certificate for testing.", d.Domain, dnsErr))
				return
			}
			// Auto fallback to self-signed
			certPath := filepath.Join(sslDir, d.Domain, "fullchain.pem")
			keyPath := filepath.Join(sslDir, d.Domain, "privkey.pem")
			info, err = ssl.GenerateSelfSigned(d.Domain, nil, certPath, keyPath)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "ssl_error", "Failed to generate fallback self-signed certificate: "+err.Error())
				return
			}
			provider = "self_signed"
			warning = fmt.Sprintf("Domain '%s' does not resolve to this host in public DNS. BarePod issued a local self-signed SSL certificate so HTTPS is operational immediately.", d.Domain)
		} else {
			_ = ip
			info, err = ssl.IssueLetsEncrypt(r.Context(), d.Domain, nil, s.letsEncryptContact(req.Email))
			if err != nil {
				// Held before the fallback overwrites err: the reason is the point of the
				// warning, and a generic "challenge was not completed" gave nothing to act on.
				issueErr := err
				if req.Provider == "letsencrypt" {
					writeError(w, http.StatusBadRequest, "letsencrypt_error", "Let's Encrypt issuance failed: "+issueErr.Error())
					return
				}
				// Auto fallback
				certPath := filepath.Join(sslDir, d.Domain, "fullchain.pem")
				keyPath := filepath.Join(sslDir, d.Domain, "privkey.pem")
				info, err = ssl.GenerateSelfSigned(d.Domain, nil, certPath, keyPath)
				if err != nil {
					writeError(w, http.StatusInternalServerError, "ssl_error", "Failed to issue certificate: "+err.Error())
					return
				}
				provider = "self_signed"
				warning = fmt.Sprintf("Let's Encrypt ACME challenge was not completed (%v). Issued self-signed fallback certificate.", issueErr)
			} else {
				provider = "letsencrypt"
			}
		}
	}

	// Update DB record
	expiresAt := info.NotAfter.Format(time.RFC3339)
	if err := s.store.UpdateDomainSSL(d.ID, provider, "active", info.CertPath, info.KeyPath, info.Issuer, expiresAt, req.ForceHTTPS, req.HSTS, true); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Failed to save SSL certificate state: "+err.Error())
		return
	}

	// Reload webserver
	if err := s.applyVhost(r, site); err != nil {
		writeError(w, http.StatusInternalServerError, "webserver_error", "Certificate installed but web server reload failed: "+err.Error())
		return
	}

	_ = s.store.Audit(user.ID, "ssl.issue", d.Domain, clientIP(r), fmt.Sprintf("provider=%s site=%s", provider, site.Slug))

	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "active",
		"provider":    provider,
		"domain":      d.Domain,
		"issuer":      info.Issuer,
		"expiresAt":   expiresAt,
		"daysLeft":    info.DaysLeft,
		"forceHTTPS":  req.ForceHTTPS,
		"hstsEnabled": req.HSTS,
		"warning":     warning,
	})
}

type uploadCustomSSLRequest struct {
	Certificate string `json:"certificate"`
	PrivateKey  string `json:"privateKey"`
	ForceHTTPS  bool   `json:"forceHTTPS"`
	HSTS        bool   `json:"hsts"`
}

// handleUploadCustomSSL accepts, validates, and installs an operator-supplied TLS keypair.
func (s *Server) handleUploadCustomSSL(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	id := r.PathValue("id")
	d, err := s.store.GetDomain(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Domain not found")
		return
	}

	site, err := s.store.WebsiteBySlug(d.WebsiteSlug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	var req uploadCustomSSLRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Malformed JSON request")
		return
	}

	if strings.TrimSpace(req.Certificate) == "" || strings.TrimSpace(req.PrivateKey) == "" {
		writeError(w, http.StatusBadRequest, "missing_keys", "Both certificate (PEM) and private key (PEM) are required")
		return
	}

	info, err := ssl.InstallCustomCert(d.Domain, []byte(req.Certificate), []byte(req.PrivateKey), s.host.SSLDirFor())
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_certificate", "Certificate validation failed: "+err.Error())
		return
	}

	expiresAt := info.NotAfter.Format(time.RFC3339)
	if err := s.store.UpdateDomainSSL(d.ID, "custom", "active", info.CertPath, info.KeyPath, info.Issuer, expiresAt, req.ForceHTTPS, req.HSTS, false); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Failed to save custom certificate state: "+err.Error())
		return
	}

	if err := s.applyVhost(r, site); err != nil {
		writeError(w, http.StatusInternalServerError, "webserver_error", "Custom certificate installed but web server reload failed: "+err.Error())
		return
	}

	_ = s.store.Audit(user.ID, "ssl.upload", d.Domain, clientIP(r), "site="+site.Slug)

	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "active",
		"provider":    "custom",
		"domain":      d.Domain,
		"issuer":      info.Issuer,
		"expiresAt":   expiresAt,
		"daysLeft":    info.DaysLeft,
		"forceHTTPS":  req.ForceHTTPS,
		"hstsEnabled": req.HSTS,
	})
}

type toggleSSLRequest struct {
	ForceHTTPS *bool `json:"forceHTTPS"`
	HSTS       *bool `json:"hsts"`
	AutoRenew  *bool `json:"autoRenew"`
}

// handleToggleSSL updates redirect flags (Force HTTPS, HSTS, Auto-Renew) and reloads the webserver.
func (s *Server) handleToggleSSL(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	id := r.PathValue("id")
	d, err := s.store.GetDomain(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Domain not found")
		return
	}

	site, err := s.store.WebsiteBySlug(d.WebsiteSlug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	var req toggleSSLRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Malformed JSON request")
		return
	}

	forceHTTPS := d.ForceHTTPS
	if req.ForceHTTPS != nil {
		forceHTTPS = *req.ForceHTTPS
	}
	hsts := d.HSTSEnabled
	if req.HSTS != nil {
		hsts = *req.HSTS
	}
	autoRenew := d.AutoRenew
	if req.AutoRenew != nil {
		autoRenew = *req.AutoRenew
	}

	if err := s.store.UpdateDomainToggles(d.ID, forceHTTPS, hsts, autoRenew); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Failed to update domain settings: "+err.Error())
		return
	}

	if err := s.applyVhost(r, site); err != nil {
		_ = s.store.UpdateDomainToggles(d.ID, d.ForceHTTPS, d.HSTSEnabled, d.AutoRenew)
		writeError(w, http.StatusInternalServerError, "webserver_error", "Failed to apply updated settings to web server: "+err.Error())
		return
	}

	updated, _ := s.store.GetDomain(id)
	writeJSON(w, http.StatusOK, updated)
}

// handleValidateDomain checks whether a domain is valid, available in BarePod, and/or already registered in Cloudflare.
func (s *Server) handleValidateDomain(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	domain := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("domain")))
	excludeDomainID := strings.TrimSpace(r.URL.Query().Get("currentDomainId"))
	websiteSlug := strings.TrimSpace(r.URL.Query().Get("websiteSlug"))
	targetUser := user.Username
	if user.Role == "admin" && r.URL.Query().Get("tenant") != "" {
		targetUser = strings.TrimSpace(r.URL.Query().Get("tenant"))
	}

	if domain == "" || strings.Contains(domain, " ") || strings.Contains(domain, "/") || !strings.Contains(domain, ".") {
		writeJSON(w, http.StatusOK, map[string]any{
			"domain":        domain,
			"validFormat":   false,
			"available":     false,
			"collisionType": "invalid_format",
			"message":       "Please provide a valid fully-qualified domain name (e.g. app.example.com)",
		})
		return
	}

	// 1. Check Panel database for collision (primary or alias domain)
	if existing, _ := s.store.GetDomainByName(domain); existing != nil && existing.ID != excludeDomainID {
		isSameSite := websiteSlug != "" && existing.WebsiteSlug == websiteSlug
		collisionType := "panel_alias"
		if existing.IsPrimary {
			collisionType = "panel_primary"
		}
		desc := "alias domain"
		if existing.IsPrimary {
			desc = "primary domain"
		}
		msg := fmt.Sprintf("Domain '%s' is already in use by website '%s' (%s)", domain, existing.WebsiteSlug, desc)
		if isSameSite {
			msg = fmt.Sprintf("Domain '%s' is already registered to this website (%s)", domain, desc)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"domain":        domain,
			"validFormat":   true,
			"available":     false,
			"collisionType": collisionType,
			"message":       msg,
			"panelUsage": map[string]any{
				"websiteSlug": existing.WebsiteSlug,
				"isPrimary":   existing.IsPrimary,
			},
		})
		return
	}

	if site, _ := s.store.WebsiteByDomain(domain); site != nil && site.Slug != websiteSlug {
		writeJSON(w, http.StatusOK, map[string]any{
			"domain":        domain,
			"validFormat":   true,
			"available":     false,
			"collisionType": "panel_primary",
			"message":       fmt.Sprintf("Domain '%s' is already in use by website '%s' (primary domain)", domain, site.Slug),
			"panelUsage": map[string]any{
				"websiteSlug": site.Slug,
				"isPrimary":   true,
			},
		})
		return
	}

	// 2. Check local Cloudflare Tunnel routes for collision
	var tunnelRouteUsage *store.CloudflareTunnelRoute
	if routes, err := s.store.ListCloudflareTunnelRoutes(targetUser); err == nil {
		for _, route := range routes {
			if strings.EqualFold(route.Hostname, domain) {
				rCopy := route
				tunnelRouteUsage = &rCopy
				break
			}
		}
	}

	// 3. Live check against Cloudflare API (if tenant has Cloudflare Tunnel configured)
	var cfCheck *cloudflare.CloudflareHostnameCheck
	tunnel, _ := s.store.GetCloudflareTunnel(targetUser)
	if tunnel != nil && tunnel.ApiToken != "" {
		cf := cloudflare.NewClient(tunnel.ApiToken, tunnel.AccountID, tunnel.TunnelID)
		ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
		cfCheck, _ = cf.CheckHostname(ctx, domain)
		cancel()
	}

	// Determine collision status for Cloudflare
	collisionType := "none"
	var cfMessage string
	if tunnelRouteUsage != nil {
		collisionType = "cf_route"
		cfMessage = fmt.Sprintf("Domain is already routed in your Cloudflare Tunnel to '%s' (App: %s)", tunnelRouteUsage.Service, tunnelRouteUsage.AppName)
	} else if cfCheck != nil && cfCheck.HasTunnelRoute {
		collisionType = "cf_route"
		cfMessage = fmt.Sprintf("Domain is already configured in Cloudflare Tunnel ingress routing to '%s'", cfCheck.TunnelService)
	} else if cfCheck != nil && cfCheck.HasDNSRecord {
		collisionType = "cf_dns"
		recSummary := ""
		if len(cfCheck.DNSRecords) > 0 {
			r0 := cfCheck.DNSRecords[0]
			recSummary = fmt.Sprintf(" (%s -> %s)", r0.Type, r0.Content)
		}
		cfMessage = fmt.Sprintf("DNS record already exists in Cloudflare%s. Pointing this domain will update/overwrite the CNAME.", recSummary)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"domain":           domain,
		"validFormat":      true,
		"available":        true,
		"collisionType":    collisionType,
		"message":          cfMessage,
		"cloudflareStatus": cfCheck,
		"tunnelRoute":      tunnelRouteUsage,
	})
}
