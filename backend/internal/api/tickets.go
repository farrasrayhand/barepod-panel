package api

import (
	"net/http"
	"sync"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// ticket is a short-lived, one-time credential for the WebSocket handshake.
// Tokens are never put in the URL, and a ticket can only be redeemed once.
type ticket struct {
	sessionID string
	expiresAt time.Time
}

type ticketStore struct {
	mu      sync.Mutex
	tickets map[string]ticket
}

func newTicketStore() *ticketStore {
	return &ticketStore{tickets: map[string]ticket{}}
}

func (t *ticketStore) issue(sessionID string, ttl time.Duration) (string, time.Time) {
	t.mu.Lock()
	defer t.mu.Unlock()
	// Opportunistic GC keeps the map tiny.
	nowT := time.Now()
	for k, v := range t.tickets {
		if v.expiresAt.Before(nowT) {
			delete(t.tickets, k)
		}
	}
	token := id.Token(24)
	exp := nowT.Add(ttl)
	t.tickets[token] = ticket{sessionID: sessionID, expiresAt: exp}
	return token, exp
}

// redeem consumes a ticket, returning the session id it belonged to.
func (t *ticketStore) redeem(token string) (string, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	v, ok := t.tickets[token]
	if !ok {
		return "", false
	}
	delete(t.tickets, token)
	if v.expiresAt.Before(time.Now()) {
		return "", false
	}
	return v.sessionID, true
}

// handleWSTicket issues a one-time WebSocket ticket for the current session.
func (s *Server) handleWSTicket(w http.ResponseWriter, r *http.Request, _ *store.User, sess *store.Session) {
	// The ticket carries the raw session token, which the terminal path resolves
	// through SessionByID (the store only ever holds its hash).
	token, exp := s.tickets.issue(sess.Token, 30*time.Second)
	writeJSON(w, http.StatusCreated, map[string]any{
		"ticket":    token,
		"expiresAt": exp.UTC().Format(time.RFC3339),
	})
}
