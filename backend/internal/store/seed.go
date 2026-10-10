package store

import (
	"github.com/farrasrayhand/barepod-panel/backend/internal/auth"
	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
)

// SeedAdmin creates the root admin account when the panel has no users yet.
// It returns the generated password (empty when the account already existed).
func (s *Store) SeedAdmin(username, password string) (string, error) {
	n, err := s.CountUsers()
	if err != nil {
		return "", err
	}
	if n > 0 {
		return "", nil
	}
	if password == "" {
		password = id.Token(9)
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return "", err
	}
	if _, err := s.CreateUser(username, username+"@barepod.local", hash, "admin", "Superadmin (Root)"); err != nil {
		return "", err
	}
	return password, nil
}

// seedWebsites is demo data so the UI has something to render on a fresh install.
var seedWebsites = []Website{
	{Slug: "flask-sentiment-api", Domain: "sentiment.barepod.cloud", TenantUser: "farras", Runtime: "python", Version: "3.12", Framework: "Flask", WebServer: "openlitespeed", Status: "running", DeployStatus: "ready", SSL: true, TunnelEnable: true, Port: 5000},
	{Slug: "larastore-commerce", Domain: "larastore.id", TenantUser: "farras", Runtime: "php", Version: "8.4", Framework: "Laravel 12", WebServer: "openlitespeed", Status: "running", DeployStatus: "ready", SSL: true, TunnelEnable: true, Port: 8001},
	{Slug: "billing-backend-api", Domain: "api.mycompany.com", TenantUser: "tenant_alex", Runtime: "nodejs", Version: "22", Framework: "Express + Next.js", WebServer: "caddy", Status: "running", DeployStatus: "ready", SSL: true, TunnelEnable: true, Port: 3000},
}

// SeedWebsites inserts demo websites when the table is empty.
func (s *Store) SeedWebsites() (int, error) {
	n, err := s.CountWebsites()
	if err != nil {
		return 0, err
	}
	if n > 0 {
		return 0, nil
	}
	for i := range seedWebsites {
		w := seedWebsites[i]
		if err := s.CreateWebsite(&w); err != nil {
			return 0, err
		}
	}
	return len(seedWebsites), nil
}
