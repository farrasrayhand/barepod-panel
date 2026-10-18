package notify

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// httpClient is shared by the HTTP channels; a hung endpoint must not hold a maintenance job open.
var httpClient = &http.Client{Timeout: 10 * time.Second}

// telegramChannel delivers through a Telegram bot.
type telegramChannel struct {
	token  string
	chatID string
}

func (telegramChannel) Name() string { return "telegram" }

func (c telegramChannel) Send(ctx context.Context, m Message) error {
	form := url.Values{}
	form.Set("chat_id", c.chatID)
	form.Set("text", m.Text())
	form.Set("disable_web_page_preview", "true")

	endpoint := "https://api.telegram.org/bot" + c.token + "/sendMessage"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("telegram returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}
