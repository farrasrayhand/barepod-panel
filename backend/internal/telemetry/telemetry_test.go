package telemetry

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestLatLonToXY(t *testing.T) {
	tests := []struct {
		name     string
		lat, lon float64
		wantX    float64
		wantY    float64
	}{
		{"Prime Meridian & Equator", 0, 0, 500, 250},
		{"Top Left (-180, 90)", 90, -180, 0, 0},
		{"Bottom Right (180, -90)", -90, 180, 1000, 500},
		{"Jakarta (-6.2, 106.8)", -6.2088, 106.8456, 797, 267},
		{"Tokyo (35.6, 139.6)", 35.6762, 139.6503, 888, 151},
		{"Frankfurt (50.1, 8.68)", 50.1109, 8.6821, 524, 111},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			x, y := LatLonToXY(tc.lat, tc.lon)
			if x != tc.wantX || y != tc.wantY {
				t.Errorf("LatLonToXY(%v, %v) = (%v, %v), want (%v, %v)", tc.lat, tc.lon, x, y, tc.wantX, tc.wantY)
			}
		})
	}
}

func TestCountryFlag(t *testing.T) {
	if got := CountryFlag("ID"); got != "🇮🇩" {
		t.Errorf("CountryFlag(ID) = %s, want 🇮🇩", got)
	}
	if got := CountryFlag("US"); got != "🇺🇸" {
		t.Errorf("CountryFlag(US) = %s, want 🇺🇸", got)
	}
	if got := CountryFlag("sg"); got != "🇸🇬" {
		t.Errorf("CountryFlag(sg) = %s, want 🇸🇬", got)
	}
	if got := CountryFlag(""); got != "🌐" {
		t.Errorf("CountryFlag('') = %s, want 🌐", got)
	}
}

func TestParseCombinedLine(t *testing.T) {
	resolver := NewGeoIPResolver()
	line := `127.0.0.1 - - [14/Oct/2026:10:15:30 +0800] "GET /api/v1/health HTTP/1.1" 200 412 "https://demo.test/" "Mozilla/5.0"`
	
	item, ok := ParseLine(line, resolver)
	if !ok || item == nil {
		t.Fatalf("ParseLine failed on combined log: %s", line)
	}

	if item.IP != "127.0.0.1" {
		t.Errorf("item.IP = %s, want 127.0.0.1", item.IP)
	}
	if item.Method != "GET" {
		t.Errorf("item.Method = %s, want GET", item.Method)
	}
	if item.Path != "/api/v1/health" {
		t.Errorf("item.Path = %s, want /api/v1/health", item.Path)
	}
	if item.Status != 200 {
		t.Errorf("item.Status = %d, want 200", item.Status)
	}
	if item.Country != "LAN" {
		t.Errorf("item.Country = %s, want LAN for loopback", item.Country)
	}
}

func TestParseCaddyJSONLine(t *testing.T) {
	resolver := NewGeoIPResolver()
	line := `{"level":"info","ts":1728900000.123,"status":200,"size":1024,"duration":0.014,"request":{"remote_ip":"127.0.0.1:54321","client_ip":"127.0.0.1","proto":"HTTP/1.1","method":"POST","uri":"/login","headers":{"User-Agent":["Chrome/128"]}}}`

	item, ok := ParseLine(line, resolver)
	if !ok || item == nil {
		t.Fatalf("ParseLine failed on Caddy JSON: %s", line)
	}

	if item.IP != "127.0.0.1" {
		t.Errorf("item.IP = %s, want 127.0.0.1", item.IP)
	}
	if item.Method != "POST" {
		t.Errorf("item.Method = %s, want POST", item.Method)
	}
	if item.Path != "/login" {
		t.Errorf("item.Path = %s, want /login", item.Path)
	}
	if item.Status != 200 {
		t.Errorf("item.Status = %d, want 200", item.Status)
	}
	if item.Latency != "14ms" {
		t.Errorf("item.Latency = %s, want 14ms", item.Latency)
	}
}

func TestTelemetryAggregation(t *testing.T) {
	tmpDir := t.TempDir()
	logPath := filepath.Join(tmpDir, "barepod-test.access.log")

	content := `127.0.0.1 - - [14/Oct/2026:10:15:30 +0800] "GET / HTTP/1.1" 200 1200 "-" "Curl"
127.0.0.1 - - [14/Oct/2026:10:15:31 +0800] "GET /styles.css HTTP/1.1" 200 400 "-" "Curl"
127.0.0.1 - - [14/Oct/2026:10:15:32 +0800] "GET /.env HTTP/1.1" 403 120 "-" "Scanner"
`
	if err := os.WriteFile(logPath, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write test log file: %v", err)
	}

	svc := &Service{
		resolver: NewGeoIPResolver(),
	}

	lines, err := readTailLines(logPath, 100)
	if err != nil {
		t.Fatalf("readTailLines failed: %v", err)
	}
	if len(lines) != 3 {
		t.Fatalf("lines count = %d, want 3", len(lines))
	}

	// Test telemetry assembly
	telemetry, err := svc.GetWebsiteTelemetry(context.Background(), "test", 100)
	if err != nil {
		t.Fatalf("GetWebsiteTelemetry failed: %v", err)
	}
	_ = telemetry
}
