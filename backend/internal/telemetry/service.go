package telemetry

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"sync"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// Service provides telemetry aggregation and streaming for BarePod websites.
type Service struct {
	resolver *GeoIPResolver
	store    *store.Store
	mu       sync.RWMutex
}

// NewService creates a new Telemetry Service.
func NewService(st *store.Store) *Service {
	return &Service{
		resolver: NewGeoIPResolver(),
		store:    st,
	}
}

// FindLogPath locates the active access log file for a given website slug.
func (s *Service) FindLogPath(slug string) string {
	candidates := []string{
		fmt.Sprintf("/var/log/caddy/barepod-%s.access.log", slug),
		fmt.Sprintf("/var/log/nginx/barepod-%s.access.log", slug),
		fmt.Sprintf("/var/log/apache2/barepod-%s.access.log", slug),
		fmt.Sprintf("/usr/local/lsws/logs/barepod-%s.access.log", slug),
		// Fallbacks
		fmt.Sprintf("/var/log/nginx/barepod-%s.access.log.1", slug),
	}
	for _, p := range candidates {
		if fi, err := os.Stat(p); err == nil && fi.Size() > 0 {
			return p
		}
	}
	// Return first candidate by default
	return candidates[0]
}

// readTailLines reads the last maxLines from a file.
func readTailLines(filePath string, maxLines int) ([]string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var lines []string
	scanner := bufio.NewScanner(file)
	// Allow up to 1MB per line for verbose headers
	buf := make([]byte, 64*1024)
	scanner.Buffer(buf, 1024*1024)

	for scanner.Scan() {
		lines = append(lines, scanner.Text())
		if len(lines) > maxLines*2 {
			lines = lines[len(lines)-maxLines:]
		}
	}
	if len(lines) > maxLines {
		lines = lines[len(lines)-maxLines:]
	}
	return lines, scanner.Err()
}

// countFileLines counts total lines in a file quickly using chunked byte scanning.
func countFileLines(filePath string) int {
	f, err := os.Open(filePath)
	if err != nil {
		return 0
	}
	defer f.Close()

	buf := make([]byte, 64*1024)
	count := 0
	for {
		n, err := f.Read(buf)
		if n > 0 {
			for i := 0; i < n; i++ {
				if buf[i] == '\n' {
					count++
				}
			}
		}
		if err != nil {
			break
		}
	}
	return count
}

// GetWebsiteTelemetry aggregates access logs and GeoIP nodes for a website.
func (s *Service) GetWebsiteTelemetry(ctx context.Context, slug string, maxLines int) (*WebsiteTelemetry, error) {
	if maxLines <= 0 || maxLines > 2000 {
		maxLines = 300
	}

	var domain = slug
	var webServer = "caddy"
	if s.store != nil {
		if site, err := s.store.WebsiteBySlug(slug); err == nil && site != nil {
			domain = site.Domain
			webServer = site.WebServer
		}
	}

	logPath := s.FindLogPath(slug)
	lines, err := readTailLines(logPath, maxLines)
	totalReqs := countFileLines(logPath)
	if totalReqs < len(lines) {
		totalReqs = len(lines)
	}

	telemetry := &WebsiteTelemetry{
		Slug:          slug,
		Domain:        domain,
		WebServer:     webServer,
		LogPath:       logPath,
		TotalRequests: totalReqs,
		UniqueIPs:     0,
		ThreatCount:   0,
		Nodes:         make([]Node, 0),
		Logs:          make([]LogItem, 0),
		UpdatedAt:     time.Now(),
	}

	if err != nil || len(lines) == 0 {
		// Log file doesn't exist yet or has no data
		return telemetry, nil
	}

	type countryAgg struct {
		countryCode string
		countryName string
		city        string
		flag        string
		isp         string
		sampleIP    string
		lat         float64
		lon         float64
		x           float64
		y           float64
		reqs        int
		threats     int
		lastLatency string
	}

	countryMap := make(map[string]*countryAgg)
	uniqueIPs := make(map[string]struct{})
	var parsedLogs []LogItem

	// Parse in reverse order so newest logs come first
	for i := len(lines) - 1; i >= 0; i-- {
		raw := lines[i]
		item, ok := ParseLine(raw, s.resolver)
		if !ok || item == nil {
			continue
		}

		if item.IP != "" {
			uniqueIPs[item.IP] = struct{}{}
		}

		isThreat := IsThreatRequest(item.Status, item.Path)
		if isThreat {
			telemetry.ThreatCount++
		}

		parsedLogs = append(parsedLogs, *item)

		// Group into geographic nodes
		cCode := item.Country
		if cCode == "" {
			cCode = "UN"
		}

		agg, exists := countryMap[cCode]
		if !exists {
			loc := s.resolver.Resolve(item.IP)
			agg = &countryAgg{
				countryCode: loc.CountryCode,
				countryName: loc.CountryName,
				city:        loc.City,
				flag:        loc.Flag,
				isp:         loc.ISP,
				sampleIP:    item.IP,
				lat:         loc.Lat,
				lon:         loc.Lon,
				x:           loc.X,
				y:           loc.Y,
				reqs:        0,
				threats:     0,
				lastLatency: item.Latency,
			}
			countryMap[cCode] = agg
		}

		agg.reqs++
		if isThreat {
			agg.threats++
		}
		if item.Latency != "" {
			agg.lastLatency = item.Latency
		}
	}

	telemetry.UniqueIPs = len(uniqueIPs)
	telemetry.Logs = parsedLogs

	// Build nodes slice
	var nodes []Node
	for _, agg := range countryMap {
		pct := 0
		if telemetry.TotalRequests > 0 {
			pct = int((float64(agg.reqs) / float64(telemetry.TotalRequests)) * 100.0)
		}
		threat := agg.threats > 0 && agg.threats >= (agg.reqs/2)
		nodes = append(nodes, Node{
			Country:     agg.countryCode,
			CountryName: agg.countryName,
			Flag:        agg.flag,
			City:        agg.city,
			IP:          agg.sampleIP,
			ISP:         agg.isp,
			X:           agg.x,
			Y:           agg.y,
			Reqs:        agg.reqs,
			Percentage:  pct,
			Latency:     agg.lastLatency,
			IsThreat:    threat,
		})
	}

	// Sort nodes by request volume descending
	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i].Reqs > nodes[j].Reqs
	})

	telemetry.Nodes = nodes
	return telemetry, nil
}

// StreamWebsiteTelemetry streams live access log events using Server-Sent Events (SSE).
func (s *Service) StreamWebsiteTelemetry(ctx context.Context, slug string, w http.ResponseWriter, r *http.Request) error {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return fmt.Errorf("streaming unsupported")
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	// 1. Initial snapshot
	initial, _ := s.GetWebsiteTelemetry(ctx, slug, 100)
	if data, err := json.Marshal(initial); err == nil {
		fmt.Fprintf(w, "event: snapshot\ndata: %s\n\n", data)
		flusher.Flush()
	}

	logPath := s.FindLogPath(slug)
	var offset int64 = 0
	if fi, err := os.Stat(logPath); err == nil {
		offset = fi.Size()
	}

	ticker := time.NewTicker(1000 * time.Millisecond)
	defer ticker.Stop()

	pingTicker := time.NewTicker(15 * time.Second)
	defer pingTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-r.Context().Done():
			return nil
		case <-pingTicker.C:
			fmt.Fprintf(w, ": ping\n\n")
			flusher.Flush()
		case <-ticker.C:
			fi, err := os.Stat(logPath)
			if err != nil || fi.Size() <= offset {
				if err == nil && fi.Size() < offset {
					// Log rotated
					offset = 0
				}
				continue
			}

			file, err := os.Open(logPath)
			if err != nil {
				continue
			}

			_, _ = file.Seek(offset, io.SeekStart)
			scanner := bufio.NewScanner(file)
			newLines := 0

			for scanner.Scan() {
				line := scanner.Text()
				item, ok := ParseLine(line, s.resolver)
				if ok && item != nil {
					newLines++
					if itemData, err := json.Marshal(item); err == nil {
						fmt.Fprintf(w, "event: hit\ndata: %s\n\n", itemData)
					}
				}
			}

			offset, _ = file.Seek(0, io.SeekCurrent)
			file.Close()

			if newLines > 0 {
				// Re-emit updated nodes & summary snapshot with true total requests
				updated, _ := s.GetWebsiteTelemetry(ctx, slug, 200)
				if snapData, err := json.Marshal(updated); err == nil {
					fmt.Fprintf(w, "event: snapshot\ndata: %s\n\n", snapData)
				}
				if nodesData, err := json.Marshal(updated.Nodes); err == nil {
					fmt.Fprintf(w, "event: nodes\ndata: %s\n\n", nodesData)
				}
				flusher.Flush()
			}
		}
	}
}
