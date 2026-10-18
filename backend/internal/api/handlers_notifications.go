package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/notify"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// notificationView is the notification configuration with its secrets masked. The panel never sends
// a bot token, webhook URL or SMTP password back to the browser — only whether one is set.
type notificationView struct {
	TelegramEnabled  bool   `json:"telegramEnabled"`
	TelegramHasToken bool   `json:"telegramHasToken"`
	TelegramChatID   string `json:"telegramChatId"`

	DiscordEnabled    bool `json:"discordEnabled"`
	DiscordHasWebhook bool `json:"discordHasWebhook"`

	SMTPEnabled     bool   `json:"smtpEnabled"`
	SMTPHost        string `json:"smtpHost"`
	SMTPPort        int    `json:"smtpPort"`
	SMTPUser        string `json:"smtpUser"`
	SMTPHasPassword bool   `json:"smtpHasPassword"`
	SMTPFrom        string `json:"smtpFrom"`
	SMTPTo          string `json:"smtpTo"`

	DiskAlertThresholdPercent int      `json:"diskAlertThresholdPercent"`
	Channels                  []string `json:"channels"`
}

func viewFromConfig(cfg notify.Config) notificationView {
	return notificationView{
		TelegramEnabled:           cfg.TelegramEnabled,
		TelegramHasToken:          cfg.TelegramBotToken != "",
		TelegramChatID:            cfg.TelegramChatID,
		DiscordEnabled:            cfg.DiscordEnabled,
		DiscordHasWebhook:         cfg.DiscordWebhookURL != "",
		SMTPEnabled:               cfg.SMTPEnabled,
		SMTPHost:                  cfg.SMTPHost,
		SMTPPort:                  cfg.SMTPPort,
		SMTPUser:                  cfg.SMTPUser,
		SMTPHasPassword:           cfg.SMTPPassword != "",
		SMTPFrom:                  cfg.SMTPFrom,
		SMTPTo:                    cfg.SMTPTo,
		DiskAlertThresholdPercent: cfg.Threshold(),
		Channels:                  notify.Build(cfg).Names(),
	}
}

// handleGetNotifications returns the alert configuration, secrets masked.
func (s *Server) handleGetNotifications(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	cfg, err := notify.LoadConfig(s.store, s.key)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, viewFromConfig(cfg))
}

// handleSaveNotifications stores the alert configuration. A secret field left empty keeps the value
// already stored, so the masked form round-trips without the browser ever holding the secret.
func (s *Server) handleSaveNotifications(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var body struct {
		TelegramEnabled  *bool   `json:"telegramEnabled"`
		TelegramBotToken *string `json:"telegramBotToken"`
		TelegramChatID   *string `json:"telegramChatId"`

		DiscordEnabled    *bool   `json:"discordEnabled"`
		DiscordWebhookURL *string `json:"discordWebhookUrl"`

		SMTPEnabled  *bool   `json:"smtpEnabled"`
		SMTPHost     *string `json:"smtpHost"`
		SMTPPort     *int    `json:"smtpPort"`
		SMTPUser     *string `json:"smtpUser"`
		SMTPPassword *string `json:"smtpPassword"`
		SMTPFrom     *string `json:"smtpFrom"`
		SMTPTo       *string `json:"smtpTo"`

		DiskAlertThresholdPercent *int `json:"diskAlertThresholdPercent"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "could not read the notification settings")
		return
	}

	cfg, err := notify.LoadConfig(s.store, s.key)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}

	if body.TelegramEnabled != nil {
		cfg.TelegramEnabled = *body.TelegramEnabled
	}
	if body.TelegramBotToken != nil && strings.TrimSpace(*body.TelegramBotToken) != "" {
		cfg.TelegramBotToken = strings.TrimSpace(*body.TelegramBotToken)
	}
	if body.TelegramChatID != nil {
		cfg.TelegramChatID = strings.TrimSpace(*body.TelegramChatID)
	}
	if body.DiscordEnabled != nil {
		cfg.DiscordEnabled = *body.DiscordEnabled
	}
	if body.DiscordWebhookURL != nil && strings.TrimSpace(*body.DiscordWebhookURL) != "" {
		cfg.DiscordWebhookURL = strings.TrimSpace(*body.DiscordWebhookURL)
	}
	if body.SMTPEnabled != nil {
		cfg.SMTPEnabled = *body.SMTPEnabled
	}
	if body.SMTPHost != nil {
		cfg.SMTPHost = strings.TrimSpace(*body.SMTPHost)
	}
	if body.SMTPPort != nil {
		cfg.SMTPPort = *body.SMTPPort
	}
	if body.SMTPUser != nil {
		cfg.SMTPUser = strings.TrimSpace(*body.SMTPUser)
	}
	if body.SMTPPassword != nil && *body.SMTPPassword != "" {
		cfg.SMTPPassword = *body.SMTPPassword
	}
	if body.SMTPFrom != nil {
		cfg.SMTPFrom = strings.TrimSpace(*body.SMTPFrom)
	}
	if body.SMTPTo != nil {
		cfg.SMTPTo = strings.TrimSpace(*body.SMTPTo)
	}
	if body.DiskAlertThresholdPercent != nil {
		threshold := *body.DiskAlertThresholdPercent
		if threshold < 1 {
			threshold = 1
		}
		if threshold > 100 {
			threshold = 100
		}
		cfg.DiskAlertThresholdPercent = threshold
	}

	if err := notify.SaveConfig(s.store, s.key, cfg); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	_ = s.store.Audit(user.ID, "system.notifications", "config", clientIP(r),
		"channels="+strings.Join(notify.Build(cfg).Names(), ","))

	writeJSON(w, http.StatusOK, viewFromConfig(cfg))
}

// handleTestNotification sends one message through every configured channel.
func (s *Server) handleTestNotification(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	cfg, err := notify.LoadConfig(s.store, s.key)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	dispatcher := notify.Build(cfg)
	if len(dispatcher.Names()) == 0 {
		writeError(w, http.StatusBadRequest, "no_channels",
			"enable at least one complete channel (Telegram, Discord or SMTP) before sending a test")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	msg := notify.Message{
		Title: "BarePod Panel test alert",
		Body:  "This is a test message from " + s.cfgHostName() + ". If you can read it, your alert channel works.",
		Level: "info",
	}
	errs := dispatcher.Send(ctx, msg)
	_ = s.store.Audit(user.ID, "system.notifications_test", "config", clientIP(r),
		strings.Join(dispatcher.Names(), ","))

	if len(errs) > 0 {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":       false,
			"channels": dispatcher.Names(),
			"errors":   errorStrings(errs),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"channels": dispatcher.Names(),
	})
}

func (s *Server) cfgHostName() string {
	if s.cfg.Listen != "" {
		return "BarePod Panel (" + s.cfg.Listen + ")"
	}
	return "BarePod Panel"
}

func errorStrings(errs []error) []string {
	out := make([]string, 0, len(errs))
	for _, err := range errs {
		out = append(out, err.Error())
	}
	return out
}
