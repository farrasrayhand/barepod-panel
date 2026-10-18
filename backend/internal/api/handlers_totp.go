package api

import (
	"net/http"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/totp"
)

// totpIssuer is what an authenticator lists the entry under.
const totpIssuer = "BarePod Panel"

// handleTOTPStatus reports whether this account has a confirmed second factor.
func (s *Server) handleTOTPStatus(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	_, enabled, err := s.store.UserTOTP(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"enabled": enabled})
}

// handleTOTPSetup starts enrolment: it stores a fresh secret (unconfirmed) and returns it with the
// otpauth:// URI the authenticator scans. Nothing changes at sign-in until a code confirms it.
func (s *Server) handleTOTPSetup(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	secret, err := totp.GenerateSecret()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not generate a secret")
		return
	}
	cipher, err := secrets.Encrypt(s.key, secret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not protect the secret")
		return
	}
	if err := s.store.SetUserTOTP(user.ID, cipher, false); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"secret":     secret,
		"otpauthUrl": totp.ProvisioningURI(totpIssuer, user.Username, secret),
	})
}

// handleTOTPEnable confirms the pending secret with a code, which is what makes it required.
func (s *Server) handleTOTPEnable(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var body struct {
		Code string `json:"code"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "could not read the code")
		return
	}

	cipher, _, err := s.store.UserTOTP(user.ID)
	if err != nil || cipher == "" {
		writeError(w, http.StatusBadRequest, "no_setup", "start the setup first")
		return
	}
	secret, err := secrets.Decrypt(s.key, cipher)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not read the stored secret")
		return
	}
	if !totp.Validate(secret, body.Code, time.Now()) {
		writeError(w, http.StatusBadRequest, "invalid_code", "that code is not right; check the clock on your phone and try the current one")
		return
	}
	if err := s.store.SetUserTOTP(user.ID, cipher, true); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	_ = s.store.Audit(user.ID, "auth.totp_enable", user.Username, clientIP(r), "")
	writeJSON(w, http.StatusOK, map[string]any{"enabled": true})
}

// handleTOTPDisable removes the second factor, after a valid code — possession is the proof.
func (s *Server) handleTOTPDisable(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var body struct {
		Code string `json:"code"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "could not read the code")
		return
	}

	cipher, enabled, err := s.store.UserTOTP(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	if !enabled || cipher == "" {
		writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
		return
	}
	secret, err := secrets.Decrypt(s.key, cipher)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not read the stored secret")
		return
	}
	if !totp.Validate(secret, body.Code, time.Now()) {
		writeError(w, http.StatusBadRequest, "invalid_code", "that code is not right")
		return
	}
	if err := s.store.SetUserTOTP(user.ID, "", false); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	_ = s.store.Audit(user.ID, "auth.totp_disable", user.Username, clientIP(r), "")
	writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
}
