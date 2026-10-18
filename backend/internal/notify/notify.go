// Package notify delivers panel alerts to the operator's own channels. It exists because the
// maintenance jobs need somewhere to report: before this, "Send Test Ping" was a toast and nothing
// in the daemon could send a message at all. Secrets (bot token, webhook URL, SMTP password) are
// stored encrypted with the panel key, never in plain text.
package notify

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// configKey is where the whole notification configuration lives in panel_settings.
const configKey = "notifications_config"

// Message is one alert. Level is a hint the channels may colour or prefix with.
type Message struct {
	Title string
	Body  string
	Level string // info | warning | critical
}

// Text is the plain rendering every channel starts from.
func (m Message) Text() string {
	title := strings.TrimSpace(m.Title)
	body := strings.TrimSpace(m.Body)
	switch {
	case title == "":
		return body
	case body == "":
		return title
	default:
		return title + "\n" + body
	}
}

// Config is the operator's notification setup, as the panel edits it.
type Config struct {
	TelegramEnabled  bool   `json:"telegramEnabled"`
	TelegramBotToken string `json:"telegramBotToken"`
	TelegramChatID   string `json:"telegramChatId"`

	DiscordEnabled    bool   `json:"discordEnabled"`
	DiscordWebhookURL string `json:"discordWebhookUrl"`

	SMTPEnabled  bool   `json:"smtpEnabled"`
	SMTPHost     string `json:"smtpHost"`
	SMTPPort     int    `json:"smtpPort"`
	SMTPUser     string `json:"smtpUser"`
	SMTPPassword string `json:"smtpPassword"`
	SMTPFrom     string `json:"smtpFrom"`
	SMTPTo       string `json:"smtpTo"`

	// DiskAlertThresholdPercent is when disk_alert fires. Zero means the default.
	DiskAlertThresholdPercent int `json:"diskAlertThresholdPercent"`
}

// Threshold returns the disk percentage disk_alert should warn at.
func (c Config) Threshold() int {
	if c.DiskAlertThresholdPercent <= 0 || c.DiskAlertThresholdPercent > 100 {
		return 90
	}
	return c.DiskAlertThresholdPercent
}

// Channel is one delivery route.
type Channel interface {
	Name() string
	Send(ctx context.Context, m Message) error
}

// Dispatcher fans one alert out to every configured channel.
type Dispatcher struct {
	Channels []Channel
}

// Send delivers to every channel, returning one error per channel that failed so a single broken
// route never hides the ones that worked.
func (d *Dispatcher) Send(ctx context.Context, m Message) []error {
	if d == nil || len(d.Channels) == 0 {
		return nil
	}
	var errs []error
	for _, c := range d.Channels {
		if err := c.Send(ctx, m); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", c.Name(), err))
		}
	}
	return errs
}

// Names lists the configured channel names, for an honest "where did this go" message.
func (d *Dispatcher) Names() []string {
	if d == nil {
		return nil
	}
	out := make([]string, 0, len(d.Channels))
	for _, c := range d.Channels {
		out = append(out, c.Name())
	}
	return out
}

// Build assembles a dispatcher from a config, including only channels that are enabled AND complete.
// An enabled-but-incomplete channel is skipped rather than failing at send time.
func Build(cfg Config) *Dispatcher {
	d := &Dispatcher{}
	if cfg.TelegramEnabled && cfg.TelegramBotToken != "" && cfg.TelegramChatID != "" {
		d.Channels = append(d.Channels, telegramChannel{token: cfg.TelegramBotToken, chatID: cfg.TelegramChatID})
	}
	if cfg.DiscordEnabled && cfg.DiscordWebhookURL != "" {
		d.Channels = append(d.Channels, discordChannel{webhookURL: cfg.DiscordWebhookURL})
	}
	if cfg.SMTPEnabled && cfg.SMTPHost != "" && cfg.SMTPTo != "" {
		d.Channels = append(d.Channels, smtpChannel{
			host: cfg.SMTPHost, port: cfg.SMTPPort, user: cfg.SMTPUser,
			password: cfg.SMTPPassword, from: cfg.SMTPFrom, to: cfg.SMTPTo,
		})
	}
	return d
}

// LoadConfig reads the stored configuration, decrypting the secret fields. A missing configuration
// is not an error: it means nothing is set up yet.
func LoadConfig(st *store.Store, key []byte) (Config, error) {
	raw, err := st.PanelSetting(configKey)
	if err != nil {
		return Config{}, err
	}
	if strings.TrimSpace(raw) == "" {
		return Config{}, nil
	}
	var cfg Config
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return Config{}, err
	}
	cfg.TelegramBotToken = decryptOrRaw(key, cfg.TelegramBotToken)
	cfg.DiscordWebhookURL = decryptOrRaw(key, cfg.DiscordWebhookURL)
	cfg.SMTPPassword = decryptOrRaw(key, cfg.SMTPPassword)
	return cfg, nil
}

// SaveConfig stores the configuration with its secret fields encrypted.
func SaveConfig(st *store.Store, key []byte, cfg Config) error {
	stored := cfg
	stored.TelegramBotToken = mustEncrypt(key, cfg.TelegramBotToken)
	stored.DiscordWebhookURL = mustEncrypt(key, cfg.DiscordWebhookURL)
	stored.SMTPPassword = mustEncrypt(key, cfg.SMTPPassword)

	blob, err := json.Marshal(stored)
	if err != nil {
		return err
	}
	return st.SavePanelSetting(configKey, string(blob))
}

// mustEncrypt encrypts a non-empty value and leaves an empty one empty (encrypting "" would store a
// ciphertext that means "no secret", which is worse than storing nothing).
func mustEncrypt(key []byte, value string) string {
	if value == "" {
		return ""
	}
	out, err := secrets.Encrypt(key, value)
	if err != nil {
		return value
	}
	return out
}

// decryptOrRaw decrypts a stored secret, and passes through anything that is not our ciphertext
// (empty values, or a value written before encryption existed).
func decryptOrRaw(key []byte, value string) string {
	if value == "" || !strings.HasPrefix(value, "v1:") {
		return value
	}
	out, err := secrets.Decrypt(key, value)
	if err != nil {
		return value
	}
	return out
}
