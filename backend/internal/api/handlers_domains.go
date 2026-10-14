package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

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
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

type addDomainRequest struct {
	WebsiteSlug string `json:"websiteSlug"`
	Domain      string `json:"domain"`
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

	_ = s.store.Audit(user.ID, "domain.add", req.Domain, clientIP(r), "site="+site.Slug)
	writeJSON(w, http.StatusCreated, d)
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
	if err != nil || !canManageSite(user, site) {
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

	_ = s.store.Audit(user.ID, "domain.delete", d.Domain, clientIP(r), "site="+site.Slug)
	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted", "id": id, "domain": d.Domain})
}

type issueSSLRequest struct {
	ForceHTTPS bool   `json:"forceHTTPS"`
	HSTS       bool   `json:"hsts"`
	Email      string `json:"email"`
	Provider   string `json:"provider"` // "letsencrypt" | "self_signed" | "auto"
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
			info, err = ssl.IssueLetsEncrypt(r.Context(), d.Domain, nil, req.Email)
			if err != nil {
				if req.Provider == "letsencrypt" {
					writeError(w, http.StatusBadRequest, "letsencrypt_error", "Let's Encrypt issuance failed: "+err.Error())
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
				warning = "Let's Encrypt ACME challenge was not completed. Issued self-signed fallback certificate."
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
