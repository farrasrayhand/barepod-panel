package telemetry

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	// Combined log regex: IP, user, date, method, path, proto, status, size, referer, user-agent
	combinedLogRe = regexp.MustCompile(`^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s*([^"]*)?"\s+(\d+)\s+(\S+)(?:\s+"([^"]*)"\s+"([^"]*)")?`)

	// Suspicious vulnerability scanning probes
	threatPatterns = []string{
		".env", "wp-login", "xmlrpc.php", "eval-stdin", "phpinfo", "setup.cgi",
		"actuator", "solr", "telescope", "alfa", "pma", "myadmin", ".git/",
	}
)

type caddyAccessLog struct {
	TS       float64 `json:"ts"`
	Status   int     `json:"status"`
	Size     int64   `json:"size"`
	Duration float64 `json:"duration"`
	Request  struct {
		RemoteIP string              `json:"remote_ip"`
		ClientIP string              `json:"client_ip"`
		Method   string              `json:"method"`
		URI      string              `json:"uri"`
		Headers  map[string][]string `json:"headers"`
	} `json:"request"`
}

// FormatBytes formats byte sizes into human-readable strings (e.g. 2.4 KB).
func FormatBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

// FormatLatency formats duration seconds into ms string (e.g. 14ms).
func FormatLatency(sec float64) string {
	if sec <= 0 {
		return "1ms"
	}
	ms := sec * 1000.0
	if ms < 1.0 {
		return "<1ms"
	}
	return fmt.Sprintf("%dms", int(ms))
}

// IsThreatRequest flags malicious access probes or 403 blocks.
func IsThreatRequest(status int, path string) bool {
	if status == 403 {
		return true
	}
	lower := strings.ToLower(path)
	for _, p := range threatPatterns {
		if strings.Contains(lower, p) {
			return true
		}
	}
	return false
}

// ParseLine parses a raw line from Caddy (JSON) or Nginx/Apache (Combined) into a LogItem.
func ParseLine(line string, resolver *GeoIPResolver) (*LogItem, bool) {
	line = strings.TrimSpace(line)
	if line == "" {
		return nil, false
	}

	// 1. Caddy JSON Log
	if strings.HasPrefix(line, "{") && strings.HasSuffix(line, "}") {
		var caddyLog caddyAccessLog
		if err := json.Unmarshal([]byte(line), &caddyLog); err == nil && caddyLog.Status > 0 {
			ip := caddyLog.Request.ClientIP
			if ip == "" {
				ip = caddyLog.Request.RemoteIP
			}
			loc := resolver.Resolve(ip)
			
			t := time.Unix(int64(caddyLog.TS), 0)
			timeStr := t.Format("15:04:05")

			latStr := FormatLatency(caddyLog.Duration)
			sizeStr := FormatBytes(caddyLog.Size)

			ua := ""
			if caddyLog.Request.Headers != nil {
				if vals := caddyLog.Request.Headers["User-Agent"]; len(vals) > 0 {
					ua = vals[0]
				}
			}

			method := caddyLog.Request.Method
			path := caddyLog.Request.URI
			msg := fmt.Sprintf("%s %s %d - %s", method, path, caddyLog.Status, latStr)
			if ua != "" {
				// short UA preview
				uaShort := ua
				if len(uaShort) > 30 {
					uaShort = uaShort[:30] + "..."
				}
				msg += " (" + uaShort + ")"
			}

			item := &LogItem{
				Time:      timeStr,
				Type:      "access",
				IP:        ip,
				Country:   loc.CountryCode,
				ISP:       loc.ISP,
				Method:    method,
				Path:      path,
				Status:    caddyLog.Status,
				Latency:   latStr,
				Size:      sizeStr,
				UserAgent: ua,
				Msg:       msg,
				RawLine:   line,
			}
			if caddyLog.Status >= 500 {
				item.Type = "error"
			}
			return item, true
		}
	}

	// 2. Nginx / Apache Combined Format
	matches := combinedLogRe.FindStringSubmatch(line)
	if len(matches) >= 7 {
		ip := matches[1]
		timeRaw := matches[2]
		method := matches[3]
		path := matches[4]
		status, _ := strconv.Atoi(matches[6])
		sizeBytes, _ := strconv.ParseInt(matches[7], 10, 64)

		ua := ""
		if len(matches) >= 10 {
			ua = matches[9]
		}

		timeStr := time.Now().Format("15:04:05")
		// parse timestamp if possible e.g. 14/Oct/2026:10:15:30 +0800
		if parsedT, err := time.Parse("02/Jan/2006:15:04:05 -0700", timeRaw); err == nil {
			timeStr = parsedT.Format("15:04:05")
		}

		loc := resolver.Resolve(ip)
		latStr := "1ms" // Nginx default combined log doesn't include $request_time unless custom
		sizeStr := FormatBytes(sizeBytes)

		msg := fmt.Sprintf("%s %s %d - %s", method, path, status, sizeStr)
		if ua != "" && ua != "-" {
			uaShort := ua
			if len(uaShort) > 30 {
				uaShort = uaShort[:30] + "..."
			}
			msg += " (" + uaShort + ")"
		}

		item := &LogItem{
			Time:      timeStr,
			Type:      "access",
			IP:        ip,
			Country:   loc.CountryCode,
			ISP:       loc.ISP,
			Method:    method,
			Path:      path,
			Status:    status,
			Latency:   latStr,
			Size:      sizeStr,
			UserAgent: ua,
			Msg:       msg,
			RawLine:   line,
		}
		if status >= 500 {
			item.Type = "error"
		}
		return item, true
	}

	// 3. Fallback raw line
	return &LogItem{
		Time:    time.Now().Format("15:04:05"),
		Type:    "access",
		Msg:     line,
		RawLine: line,
	}, true
}
