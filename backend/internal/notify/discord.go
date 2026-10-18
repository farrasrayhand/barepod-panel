package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// discordChannel delivers through a Discord channel webhook.
type discordChannel struct {
	webhookURL string
}

func (discordChannel) Name() string { return "discord" }

func (c discordChannel) Send(ctx context.Context, m Message) error {
	payload, err := json.Marshal(map[string]string{"content": m.Text()})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.webhookURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("discord returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}
