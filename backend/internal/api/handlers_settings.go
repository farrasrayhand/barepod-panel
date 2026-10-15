package api

import (
	"fmt"
	"net"
	"net/http"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/validate"
)

// externalAddressKey is the panel-wide setting for "the address an external client should use".
//
// It exists because the daemon cannot work that out for itself: behind NAT it has no public address
// to discover, a domain is knowledge only the operator has, and a domain proxied by a CDN carries
// only HTTP(S) on its own ports — so it can never be a database address. Measured on the test host,
// where the panel's own interfaces are 127.0.0.1, 172.19.1.26 and 172.17.0.1: there is nothing to
// detect, and an external echo service would return the wrong thing (a proxy's edge address, or an
// ISP address that is not reachable at all).
const externalAddressKey = "external_address"

// panelFQDNKey is the panel's own public hostname, published through the administrator's Cloudflare
// Tunnel. It is a setting rather than a measurement: behind a tunnel there is nothing on the host to
// detect, and the name only exists because the operator picked it in their Cloudflare account.
const panelFQDNKey = "panel_fqdn"

// panelUseCloudflareKey records which address the panel is meant to be reached on: the public IP by
// default, or the Cloudflare Tunnel hostname once an administrator turns it on. It is a choice, not a
// measurement — the panel cannot tell from the host which of the two the operator wants to use.
const panelUseCloudflareKey = "panel_use_cloudflare"

// handlePanelSettings reads the panel-wide settings. Any signed-in user may look: these values end
// up in the snippets an operator hands out, and they are not secrets.
func (s *Server) handlePanelSettings(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	address, err := s.store.PanelSetting(externalAddressKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	fqdn, err := s.store.PanelSetting(panelFQDNKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	useCloudflare, err := s.store.PanelSetting(panelUseCloudflareKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	trusted, err := s.store.TrustedAddresses()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"externalAddress": address,
		"panelFqdn":       fqdn,
		"useCloudflare":   useCloudflare == "true",
		// The addresses the lockout must never ban, and the reason it matters that they are visible:
		// this list can be empty without anything saying so, which is exactly the foot-gun it exists to
		// remove. The operator's own address is added by any successful sign-in.
		"trustedAddresses": trusted,
	})
}

// handleSavePanelSettings changes them. Administrative, and audited: an address published to clients
// is a decision worth a name against it.
func (s *Server) handleSavePanelSettings(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var body struct {
		ExternalAddress  *string   `json:"externalAddress"`
		PanelFQDN        *string   `json:"panelFqdn"`
		UseCloudflare    *bool     `json:"useCloudflare"`
		TrustedAddresses *[]string `json:"trustedAddresses"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "could not read the settings")
		return
	}
	if body.ExternalAddress == nil && body.PanelFQDN == nil && body.UseCloudflare == nil && body.TrustedAddresses == nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "nothing to change")
		return
	}
	clean := []string{}
	if body.TrustedAddresses != nil {
		for _, entry := range *body.TrustedAddresses {
			entry = strings.TrimSpace(entry)
			if entry == "" {
				continue
			}
			// One address or one network, nothing else: an entry that is neither would be counted as
			// protection while protecting nothing.
			if net.ParseIP(entry) == nil {
				if _, _, err := net.ParseCIDR(entry); err != nil {
					writeError(w, http.StatusBadRequest, "invalid_address",
						"give an address or a network, one per entry: "+entry)
					return
				}
			}
			clean = append(clean, entry)
		}
		if err := s.store.SetTrustedAddresses(clean); err != nil {
			writeError(w, http.StatusInternalServerError, "store_error", err.Error())
			return
		}
		_ = s.store.Audit(user.ID, "panel.trusted", "bruteforce", clientIP(r),
			fmt.Sprintf("%d entry/entries: %s", len(clean), strings.Join(clean, ",")))
	}
	if body.PanelFQDN != nil {
		fqdn := strings.ToLower(strings.TrimSpace(*body.PanelFQDN))
		// Empty clears it, which is how the hostname is removed rather than left saying something
		// stale; anything else has to be a domain a tunnel could actually route.
		if fqdn != "" && !validate.FQDN(fqdn) {
			writeError(w, http.StatusBadRequest, "invalid_domain", "that does not look like a domain name")
			return
		}
		if err := s.store.SavePanelSetting(panelFQDNKey, fqdn); err != nil {
			writeError(w, http.StatusInternalServerError, "store_error", err.Error())
			return
		}
		_ = s.store.Audit(user.ID, "panel.settings", "panel_fqdn", clientIP(r), "set to "+fqdn)
	}
	if body.UseCloudflare != nil {
		// "true" turns the tunnel hostname on; anything else falls back to the public address.
		value := "true"
		if !*body.UseCloudflare {
			value = ""
		}
		if err := s.store.SavePanelSetting(panelUseCloudflareKey, value); err != nil {
			writeError(w, http.StatusInternalServerError, "store_error", err.Error())
			return
		}
		_ = s.store.Audit(user.ID, "panel.settings", "panel_use_cloudflare", clientIP(r), "set to "+value)
	}
	if body.ExternalAddress == nil {
		fqdn, _ := s.store.PanelSetting(panelFQDNKey)
		useCloudflare, _ := s.store.PanelSetting(panelUseCloudflareKey)
		writeJSON(w, http.StatusOK, map[string]any{
			"panelFqdn":        fqdn,
			"useCloudflare":    useCloudflare == "true",
			"trustedAddresses": clean,
		})
		return
	}
	address := strings.TrimSpace(*body.ExternalAddress)
	if address != "" {
		// A host, not a URL: the port comes from the record, and a scheme or path here would be
		// pasted into a connection string as-is and break it. Accepting either shape quietly would
		// mean the panel handing clients an address it knows is malformed.
		if strings.ContainsAny(address, "/: \t") {
			writeError(w, http.StatusBadRequest, "invalid_address",
				"give a bare hostname or IP address, without a scheme, path or port")
			return
		}
		if net.ParseIP(address) == nil && !strings.Contains(address, ".") {
			writeError(w, http.StatusBadRequest, "invalid_address",
				"that does not look like a hostname or an IP address")
			return
		}
	}
	if err := s.store.SavePanelSetting(externalAddressKey, address); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	detail := "cleared — the panel will name the address it is being used on"
	if address != "" {
		detail = "set to " + address
	}
	_ = s.store.Audit(user.ID, "panel.settings", "external_address", clientIP(r), detail)
	writeJSON(w, http.StatusOK, map[string]any{"externalAddress": address})
}
