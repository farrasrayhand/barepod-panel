package telemetry

import "time"

// Node represents a geographic cluster of visitors on the vector world map.
// The (x, y) coordinates match the 1000x500 equirectangular SVG projection.
type Node struct {
	Country     string  `json:"country"`     // e.g. "ID", "SG", "US"
	CountryName string  `json:"countryName"` // e.g. "Indonesia"
	Flag        string  `json:"flag"`        // e.g. "🇮🇩"
	City        string  `json:"city"`        // e.g. "Jakarta"
	IP          string  `json:"ip"`          // sample IP
	ISP         string  `json:"isp"`         // ISP or cloud network
	X           float64 `json:"x"`           // 0..1000 SVG coordinate
	Y           float64 `json:"y"`           // 0..500 SVG coordinate
	Reqs        int     `json:"reqs"`        // request count
	Percentage  int     `json:"percentage"`  // % share of total requests
	Latency     string  `json:"latency"`     // e.g. "12ms"
	IsThreat    bool    `json:"isThreat"`    // true if 4xx scanner or WAF blocked
}

// LogItem represents an individual HTTP access or error event.
type LogItem struct {
	Time      string `json:"time"`
	Type      string `json:"type"` // "access" | "error"
	IP        string `json:"ip,omitempty"`
	Country   string `json:"country,omitempty"`
	ISP       string `json:"isp,omitempty"`
	Method    string `json:"method,omitempty"`
	Path      string `json:"path,omitempty"`
	Status    int    `json:"status,omitempty"`
	Latency   string `json:"latency,omitempty"`
	Size      string `json:"size,omitempty"`
	UserAgent string `json:"userAgent,omitempty"`
	Msg       string `json:"msg"`
	RawLine   string `json:"rawLine,omitempty"`
}

// WebsiteTelemetry is the aggregated snapshot for a site's traffic map and streaming logs.
type WebsiteTelemetry struct {
	Slug          string    `json:"slug"`
	Domain        string    `json:"domain"`
	WebServer     string    `json:"webServer"`
	LogPath       string    `json:"logPath"`
	TotalRequests int       `json:"totalRequests"`
	UniqueIPs     int       `json:"uniqueIps"`
	ThreatCount   int       `json:"threatCount"`
	Nodes         []Node    `json:"nodes"`
	Logs          []LogItem `json:"logs"`
	UpdatedAt     time.Time `json:"updatedAt"`
}
