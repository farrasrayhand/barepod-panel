package cloudflare

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// TunnelTokenPayload represents the JSON payload inside a Cloudflare Tunnel Run Token.
type TunnelTokenPayload struct {
	AccountID string `json:"a"`
	TunnelID  string `json:"t"`
	Secret    string `json:"s"`
}

// CleanTunnelToken extracts the raw base64 JWT token from full shell commands
// (e.g. sudo cloudflared service install <token>, docker run ... --token <token>, or cloudflared.exe ...).
func CleanTunnelToken(raw string) string {
	raw = strings.TrimSpace(raw)
	re := regexp.MustCompile(`eyJh[A-Za-z0-9_-]{20,}`)
	if match := re.FindString(raw); match != "" {
		return match
	}
	return raw
}

// ParseTunnelToken decodes a base64 Cloudflare Tunnel token and extracts the Account ID and Tunnel ID.
func ParseTunnelToken(rawToken string) (*TunnelTokenPayload, error) {
	rawToken = CleanTunnelToken(rawToken)
	if rawToken == "" {
		return nil, errors.New("empty token")
	}

	decoded, err := base64.StdEncoding.DecodeString(rawToken)
	if err != nil {
		// try URL encoding if standard fails
		decoded, err = base64.URLEncoding.DecodeString(rawToken)
		if err != nil {
			return nil, fmt.Errorf("invalid base64 token: %w", err)
		}
	}

	var payload TunnelTokenPayload
	if err := json.Unmarshal(decoded, &payload); err != nil {
		return nil, fmt.Errorf("invalid token JSON: %w", err)
	}

	if payload.AccountID == "" || payload.TunnelID == "" {
		return nil, errors.New("missing account or tunnel id in token payload")
	}

	return &payload, nil
}

// IngressRule is one routing entry in Cloudflare Zero Trust.
type IngressRule struct {
	Hostname      string         `json:"hostname,omitempty"`
	Path          string         `json:"path,omitempty"`
	Service       string         `json:"service"`
	OriginRequest map[string]any `json:"originRequest,omitempty"`
}

// TunnelConfig is the configuration structure for cfd_tunnel.
type TunnelConfig struct {
	Ingress     []IngressRule  `json:"ingress"`
	WarpRouting map[string]any `json:"warp-routing,omitempty"`
}

type cfResponse struct {
	Success  bool            `json:"success"`
	Errors   []cfError       `json:"errors"`
	Messages []string        `json:"messages"`
	Result   json.RawMessage `json:"result"`
}

type cfError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Client wraps Cloudflare API v4 calls for tunnel and DNS configuration.
type Client struct {
	apiToken   string
	accountID  string
	tunnelID   string
	httpClient *http.Client
}

// NewClient returns a new Cloudflare API client.
func NewClient(apiToken, accountID, tunnelID string) *Client {
	return &Client{
		apiToken:  strings.TrimSpace(apiToken),
		accountID: strings.TrimSpace(accountID),
		tunnelID:  strings.TrimSpace(tunnelID),
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

func (c *Client) request(ctx context.Context, method, endpoint string, body any) (*cfResponse, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		bodyReader = bytes.NewReader(data)
	}

	url := "https://api.cloudflare.com/client/v4" + endpoint
	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+c.apiToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("cloudflare API request error: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var cfResp cfResponse
	if err := json.Unmarshal(respBytes, &cfResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w (status %d)", err, resp.StatusCode)
	}

	if !cfResp.Success && len(cfResp.Errors) > 0 {
		var msgs []string
		for _, e := range cfResp.Errors {
			msgs = append(msgs, fmt.Sprintf("[%d] %s", e.Code, e.Message))
		}
		return &cfResp, fmt.Errorf("cloudflare API error: %s", strings.Join(msgs, ", "))
	}

	return &cfResp, nil
}

// VerifyToken checks whether the provided API token is valid.
func (c *Client) VerifyToken(ctx context.Context) (bool, error) {
	_, err := c.request(ctx, "GET", "/user/tokens/verify", nil)
	if err != nil {
		return false, err
	}
	return true, nil
}

// GetTunnelConfig retrieves the current remote ingress configuration from Cloudflare.
func (c *Client) GetTunnelConfig(ctx context.Context) (*TunnelConfig, error) {
	endpoint := fmt.Sprintf("/accounts/%s/cfd_tunnel/%s/configurations", c.accountID, c.tunnelID)
	resp, err := c.request(ctx, "GET", endpoint, nil)
	if err != nil {
		return nil, err
	}

	var wrapper struct {
		Config TunnelConfig `json:"config"`
	}
	if err := json.Unmarshal(resp.Result, &wrapper); err != nil {
		return nil, fmt.Errorf("failed to parse config result: %w", err)
	}

	return &wrapper.Config, nil
}

// AddIngressRule adds or updates a hostname route in Cloudflare Zero Trust and configures DNS CNAME.
func (c *Client) AddIngressRule(ctx context.Context, hostname, service string, noTLSVerify bool) error {
	hostname = strings.ToLower(strings.TrimSpace(hostname))
	service = strings.TrimSpace(service)

	cfg, err := c.GetTunnelConfig(ctx)
	if err != nil {
		// If no config exists yet, initialize a new one
		cfg = &TunnelConfig{
			Ingress: []IngressRule{
				{Service: "http_status:404"},
			},
		}
	}

	originReq := map[string]any{}
	if noTLSVerify || strings.HasPrefix(strings.ToLower(service), "https://") {
		originReq["noTLSVerify"] = true
	}

	// Rebuild ingress rules with our new or updated rule
	var updatedRules []IngressRule
	var catchAll *IngressRule
	replaced := false

	for _, rule := range cfg.Ingress {
		if rule.Hostname == "" {
			ruleCopy := rule
			catchAll = &ruleCopy
			continue
		}
		if strings.EqualFold(rule.Hostname, hostname) {
			// Update existing rule
			rOriginReq := rule.OriginRequest
			if rOriginReq == nil {
				rOriginReq = map[string]any{}
			}
			if noTLSVerify || strings.HasPrefix(strings.ToLower(service), "https://") {
				rOriginReq["noTLSVerify"] = true
			}
			updatedRules = append(updatedRules, IngressRule{
				Hostname:      hostname,
				Service:       service,
				OriginRequest: rOriginReq,
			})
			replaced = true
		} else {
			updatedRules = append(updatedRules, rule)
		}
	}

	if !replaced {
		newRule := IngressRule{
			Hostname: hostname,
			Service:  service,
		}
		if len(originReq) > 0 {
			newRule.OriginRequest = originReq
		}
		updatedRules = append(updatedRules, newRule)
	}

	// Always end with catch-all rule
	if catchAll == nil {
		catchAll = &IngressRule{Service: "http_status:404"}
	}
	updatedRules = append(updatedRules, *catchAll)

	// Save back to Cloudflare
	payload := map[string]any{
		"config": map[string]any{
			"ingress": updatedRules,
		},
	}
	endpoint := fmt.Sprintf("/accounts/%s/cfd_tunnel/%s/configurations", c.accountID, c.tunnelID)
	if _, err := c.request(ctx, "PUT", endpoint, payload); err != nil {
		return fmt.Errorf("failed to update tunnel configuration: %w", err)
	}

	// Also ensure DNS CNAME is present in Cloudflare DNS
	_ = c.EnsureDNSCname(ctx, hostname)

	return nil
}

// DeleteIngressRule removes a public hostname route from Cloudflare Zero Trust.
func (c *Client) DeleteIngressRule(ctx context.Context, hostname string) error {
	hostname = strings.ToLower(strings.TrimSpace(hostname))

	cfg, err := c.GetTunnelConfig(ctx)
	if err != nil {
		return err
	}

	var updatedRules []IngressRule
	var catchAll *IngressRule
	found := false

	for _, rule := range cfg.Ingress {
		if rule.Hostname == "" {
			ruleCopy := rule
			catchAll = &ruleCopy
			continue
		}
		if strings.EqualFold(rule.Hostname, hostname) {
			found = true
			continue // skip to remove
		}
		updatedRules = append(updatedRules, rule)
	}

	if !found {
		return nil // nothing to delete
	}

	if catchAll == nil {
		catchAll = &IngressRule{Service: "http_status:404"}
	}
	updatedRules = append(updatedRules, *catchAll)

	payload := map[string]any{
		"config": map[string]any{
			"ingress": updatedRules,
		},
	}
	endpoint := fmt.Sprintf("/accounts/%s/cfd_tunnel/%s/configurations", c.accountID, c.tunnelID)
	if _, err := c.request(ctx, "PUT", endpoint, payload); err != nil {
		return fmt.Errorf("failed to delete tunnel route: %w", err)
	}

	return nil
}

// EnsureDNSCname finds the corresponding zone and ensures a CNAME record exists pointing to the tunnel.
func (c *Client) EnsureDNSCname(ctx context.Context, hostname string) error {
	parts := strings.Split(hostname, ".")
	if len(parts) < 2 {
		return errors.New("invalid hostname")
	}

	// Try finding zone by testing domain suffixes (e.g. tjkt-project.my.id, my.id)
	var zoneID string
	for i := 0; i < len(parts)-1; i++ {
		candidateZone := strings.Join(parts[i:], ".")
		resp, err := c.request(ctx, "GET", "/zones?name="+candidateZone, nil)
		if err == nil && resp.Success {
			var zones []struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			}
			if err := json.Unmarshal(resp.Result, &zones); err == nil && len(zones) > 0 {
				zoneID = zones[0].ID
				break
			}
		}
	}

	if zoneID == "" {
		return fmt.Errorf("could not locate Cloudflare Zone for hostname: %s", hostname)
	}

	tunnelTarget := fmt.Sprintf("%s.cfargotunnel.com", c.tunnelID)

	// Check if DNS record exists
	endpoint := fmt.Sprintf("/zones/%s/dns_records?name=%s", zoneID, hostname)
	resp, err := c.request(ctx, "GET", endpoint, nil)
	if err == nil && resp.Success {
		var records []struct {
			ID      string `json:"id"`
			Type    string `json:"type"`
			Content string `json:"content"`
		}
		_ = json.Unmarshal(resp.Result, &records)
		if len(records) > 0 {
			// Record exists, update if needed
			if records[0].Type == "CNAME" && strings.EqualFold(records[0].Content, tunnelTarget) {
				return nil // already pointing correctly
			}
			updateEndpoint := fmt.Sprintf("/zones/%s/dns_records/%s", zoneID, records[0].ID)
			_, _ = c.request(ctx, "PATCH", updateEndpoint, map[string]any{
				"type":    "CNAME",
				"name":    hostname,
				"content": tunnelTarget,
				"proxied": true,
			})
			return nil
		}
	}

	// Create new CNAME record
	createEndpoint := fmt.Sprintf("/zones/%s/dns_records", zoneID)
	_, err = c.request(ctx, "POST", createEndpoint, map[string]any{
		"type":    "CNAME",
		"name":    hostname,
		"content": tunnelTarget,
		"ttl":     1,
		"proxied": true,
	})
	return err
}
