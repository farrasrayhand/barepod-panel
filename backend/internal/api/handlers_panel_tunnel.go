package api

import (
	"log"
	"net"
	"net/http"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/cloudflare"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/validate"
)

// panelTunnelStatus is what the settings screen shows for the panel's own hostname.
type panelTunnelStatus struct {
	Configured bool   `json:"configured"`
	FQDN       string `json:"fqdn"`
	Service    string `json:"service"`
	AccountID  string `json:"accountId"`
	TunnelID   string `json:"tunnelId"`
}

// panelTunnelService is where cloudflared should send the panel's traffic. The panel listens on every
// interface, but the tunnel runs on this same host, so it is reached over loopback on the port the
// daemon was told to serve.
func (s *Server) panelTunnelService() string {
	_, port, err := net.SplitHostPort(s.cfg.Listen)
	if err != nil || port == "" {
		port = "8443"
	}
	scheme := "http"
	if s.cfg.TLS {
		scheme = "https"
	}
	return scheme + "://127.0.0.1:" + port
}

// adminTunnel returns the administrator's own Cloudflare Tunnel. The panel's public domain may only
// be published through the admin's account — a tenant's token must never be able to expose the panel.
func (s *Server) adminTunnel(user *store.User) (*store.CloudflareTunnel, bool) {
	tunnel, err := s.store.GetCloudflareTunnel(user.Username)
	if err != nil || tunnel == nil {
		return nil, false
	}
	ready := tunnel.ApiToken != "" && tunnel.AccountID != "" && tunnel.TunnelID != ""
	return tunnel, ready
}

// handlePanelTunnelStatus reports whether the admin's Cloudflare account can publish the panel, and
// the hostname currently published (if any). Detection only: nothing is changed here.
func (s *Server) handlePanelTunnelStatus(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	if user.Role != "admin" {
		writeError(w, http.StatusForbidden, "admin_required", "Only an administrator can manage the panel's own domain")
		return
	}

	fqdn, _ := s.store.PanelSetting(panelFQDNKey)
	status := panelTunnelStatus{FQDN: fqdn, Service: s.panelTunnelService()}
	if tunnel, ready := s.adminTunnel(user); ready {
		status.Configured = true
		status.AccountID = tunnel.AccountID
		status.TunnelID = tunnel.TunnelID
	}
	writeJSON(w, http.StatusOK, status)
}

// handlePublishPanel routes the panel's hostname through the admin's Cloudflare Tunnel: it writes the
// ingress rule (and the DNS CNAME) in Cloudflare and records the hostname as the panel's own.
func (s *Server) handlePublishPanel(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	if user.Role != "admin" {
		writeError(w, http.StatusForbidden, "admin_required", "Only an administrator can manage the panel's own domain")
		return
	}

	var body struct {
		Hostname string `json:"hostname"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "could not read the hostname")
		return
	}

	hostname := strings.ToLower(strings.TrimSpace(body.Hostname))
	if !validate.FQDN(hostname) {
		writeError(w, http.StatusBadRequest, "invalid_domain", "pick a fully-qualified domain name, for example panel.example.com")
		return
	}

	tunnel, ready := s.adminTunnel(user)
	if !ready {
		writeError(w, http.StatusBadRequest, "cloudflare_not_configured",
			"Configure your Cloudflare API token and tunnel first (Cloudflare Tunnel page)")
		return
	}

	service := s.panelTunnelService()
	cf := cloudflare.NewClient(tunnel.ApiToken, tunnel.AccountID, tunnel.TunnelID)
	if err := cf.AddIngressRule(r.Context(), hostname, service, true); err != nil {
		log.Printf("cloudflare: publish panel at %s: %v", hostname, err)
		writeError(w, http.StatusBadGateway, "cloudflare_error", err.Error())
		return
	}

	if _, err := s.store.CreateCloudflareTunnelRoute(user.Username, hostname, service, "BarePod Panel"); err != nil {
		log.Printf("cloudflare: record panel route %s: %v", hostname, err)
	}
	if err := s.store.SavePanelSetting(panelFQDNKey, hostname); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	// Publishing is what "use Cloudflare" means, so keep the mode flag in step with it.
	_ = s.store.SavePanelSetting(panelUseCloudflareKey, "true")
	_ = s.store.Audit(user.ID, "panel.publish", hostname, clientIP(r), "Published the panel through Cloudflare at "+hostname)

	writeJSON(w, http.StatusOK, panelTunnelStatus{
		Configured: true,
		FQDN:       hostname,
		Service:    service,
		AccountID:  tunnel.AccountID,
		TunnelID:   tunnel.TunnelID,
	})
}

// handleUnpublishPanel removes the panel's hostname from Cloudflare and clears the setting.
func (s *Server) handleUnpublishPanel(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	if user.Role != "admin" {
		writeError(w, http.StatusForbidden, "admin_required", "Only an administrator can manage the panel's own domain")
		return
	}

	fqdn, _ := s.store.PanelSetting(panelFQDNKey)
	tunnel, ready := s.adminTunnel(user)
	if fqdn != "" && ready {
		cf := cloudflare.NewClient(tunnel.ApiToken, tunnel.AccountID, tunnel.TunnelID)
		if err := cf.DeleteIngressRule(r.Context(), fqdn); err != nil {
			log.Printf("cloudflare: unpublish panel at %s: %v", fqdn, err)
		}
		_ = s.store.DeleteCloudflareTunnelRoute(user.Username, fqdn)
	}
	_ = s.store.SavePanelSetting(panelFQDNKey, "")
	_ = s.store.SavePanelSetting(panelUseCloudflareKey, "")
	_ = s.store.Audit(user.ID, "panel.unpublish", fqdn, clientIP(r), "Removed the panel's Cloudflare hostname")

	status := panelTunnelStatus{Service: s.panelTunnelService()}
	if ready {
		status.Configured = true
		status.AccountID = tunnel.AccountID
		status.TunnelID = tunnel.TunnelID
	}
	writeJSON(w, http.StatusOK, status)
}
