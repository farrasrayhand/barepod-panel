package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// An unknown API route must answer with JSON, never with the SPA, or a client
// parsing JSON gets an HTML page and fails somewhere confusing.
func TestUnknownAPIRouteIs404JSON(t *testing.T) {
	panel := newTestPanel(t)

	for _, path := range []string{"/api/v1/ngawur", "/api/v1/websites/tidak-ada/files/ngawur"} {
		req, err := http.NewRequest(http.MethodGet, panel.server.URL+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		resp, err := panel.client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		payload, _ := readAll(resp.Body)
		_ = resp.Body.Close()

		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("%s: status = %d, want 404", path, resp.StatusCode)
		}
		if !strings.Contains(resp.Header.Get("Content-Type"), "application/json") {
			t.Errorf("%s: content type = %q, want JSON", path, resp.Header.Get("Content-Type"))
		}
		var body struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if err := json.Unmarshal(payload, &body); err != nil {
			t.Errorf("%s: body is not JSON: %s", path, payload)
			continue
		}
		if body.Error.Code == "" {
			t.Errorf("%s: error code is empty", path)
		}
	}
}

// A page route with no frontend build present still answers 404 rather than
// pretending anything was served.
func TestUnknownPageWithoutBuild(t *testing.T) {
	panel := newTestPanel(t)

	req, err := http.NewRequest(http.MethodGet, panel.server.URL+"/asdasdasd", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := panel.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 when no build is served", resp.StatusCode)
	}
}

func readAll(body interface{ Read([]byte) (int, error) }) ([]byte, error) {
	buf := make([]byte, 0, 4096)
	chunk := make([]byte, 4096)
	for {
		n, err := body.Read(chunk)
		buf = append(buf, chunk[:n]...)
		if err != nil {
			if err.Error() == "EOF" {
				return buf, nil
			}
			return buf, err
		}
	}
}
