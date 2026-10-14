package telemetry

import (
	"encoding/json"
	"math"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// GeoLocation represents the resolved geographic data for an IP.
type GeoLocation struct {
	CountryCode string  `json:"countryCode"`
	CountryName string  `json:"countryName"`
	City        string  `json:"city"`
	ISP         string  `json:"isp"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
	Flag        string  `json:"flag"`
	IsPrivate   bool    `json:"isPrivate"`
}

// LatLonToXY projects (latitude, longitude) onto a 1000x500 Equirectangular SVG viewBox.
// Longitude: -180..+180 maps to X: 0..1000
// Latitude: +90..-90 maps to Y: 0..500
func LatLonToXY(lat, lon float64) (x, y float64) {
	x = (lon + 180.0) * (1000.0 / 360.0)
	y = (90.0 - lat) * (500.0 / 180.0)
	if x < 0 {
		x = 0
	} else if x > 1000 {
		x = 1000
	}
	if y < 0 {
		y = 0
	} else if y > 500 {
		y = 500
	}
	return math.Round(x), math.Round(y)
}

// CountryFlag converts a 2-letter ISO country code (e.g. "ID") into its unicode flag emoji ("🇮🇩").
func CountryFlag(code string) string {
	code = strings.ToUpper(strings.TrimSpace(code))
	if len(code) != 2 {
		return "🌐"
	}
	r1 := rune(0x1F1E6 + int(code[0]-'A'))
	r2 := rune(0x1F1E6 + int(code[1]-'A'))
	if r1 < 0x1F1E6 || r1 > 0x1F1FF || r2 < 0x1F1E6 || r2 > 0x1F1FF {
		return "🌐"
	}
	return string([]rune{r1, r2})
}

// GeoIPResolver handles dynamic IP resolution with in-memory caching and host location auto-discovery.
type GeoIPResolver struct {
	cache        sync.Map
	httpClient   *http.Client
	hostLocMu    sync.RWMutex
	hostLocation *GeoLocation
}

// NewGeoIPResolver creates a thread-safe resolver with 1.5s external timeout.
func NewGeoIPResolver() *GeoIPResolver {
	r := &GeoIPResolver{
		httpClient: &http.Client{
			Timeout: 1500 * time.Millisecond,
		},
	}
	// Detect the host node's real outbound location asynchronously
	go r.detectHostLocation()
	return r
}

// detectHostLocation detects the server's real geographical position dynamically.
func (r *GeoIPResolver) detectHostLocation() {
	hName, _ := os.Hostname()
	if hName == "" {
		hName = "Local Host"
	}

	req, err := http.NewRequest("GET", "http://ip-api.com/json/?fields=status,country,countryCode,city,lat,lon,isp", nil)
	if err == nil {
		req.Header.Set("User-Agent", "BarePod-Panel/1.0")
		resp, err := r.httpClient.Do(req)
		if err == nil && resp.StatusCode == http.StatusOK {
			defer resp.Body.Close()
			var res ipAPIResponse
			if err := json.NewDecoder(resp.Body).Decode(&res); err == nil && res.Status == "success" {
				x, y := LatLonToXY(res.Lat, res.Lon)
				r.hostLocMu.Lock()
				r.hostLocation = &GeoLocation{
					CountryCode: "LAN",
					CountryName: "Local Network",
					City:        hName + " (" + res.City + ")",
					ISP:         res.ISP,
					Lat:         res.Lat,
					Lon:         res.Lon,
					X:           x,
					Y:           y,
					Flag:        "🏠",
					IsPrivate:   true,
				}
				r.hostLocMu.Unlock()
				return
			}
		}
	}

	// Default fallback if server has no external internet
	x, y := LatLonToXY(0, 0)
	r.hostLocMu.Lock()
	r.hostLocation = &GeoLocation{
		CountryCode: "LAN",
		CountryName: "Local Network",
		City:        hName,
		ISP:         "Local Gateway",
		Lat:         0,
		Lon:         0,
		X:           x,
		Y:           y,
		Flag:        "🏠",
		IsPrivate:   true,
	}
	r.hostLocMu.Unlock()
}

// getHostLocation returns the detected host location safely.
func (r *GeoIPResolver) getHostLocation() GeoLocation {
	r.hostLocMu.RLock()
	defer r.hostLocMu.RUnlock()
	if r.hostLocation != nil {
		return *r.hostLocation
	}
	hName, _ := os.Hostname()
	if hName == "" {
		hName = "Local Host Node"
	}
	return GeoLocation{
		CountryCode: "LAN",
		CountryName: "Local Network",
		City:        hName,
		ISP:         "Local Host Gateway",
		Lat:         0,
		Lon:         0,
		X:           500,
		Y:           250,
		Flag:        "🏠",
		IsPrivate:   true,
	}
}

// isPrivateIP checks if an IP is loopback, RFC1918 private, link-local, or CGNAT.
func isPrivateIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsPrivate() {
		return true
	}
	// Check CGNAT (100.64.0.0/10)
	if ip4 := ip.To4(); ip4 != nil {
		if ip4[0] == 100 && (ip4[1]&0xC0) == 64 {
			return true
		}
	}
	return false
}

// Resolve returns the GeoLocation for a given raw IP string dynamically.
func (r *GeoIPResolver) Resolve(rawIP string) GeoLocation {
	cleanIP := strings.TrimSpace(rawIP)
	// Strip port if present (e.g. 114.124.180.52:54321)
	if host, _, err := net.SplitHostPort(cleanIP); err == nil {
		cleanIP = host
	}
	parsed := net.ParseIP(cleanIP)
	if parsed == nil {
		cleanIP = "127.0.0.1"
		parsed = net.ParseIP("127.0.0.1")
	}

	// 1. Private / Loopback IP -> dynamically mapped to this host's real location
	if isPrivateIP(parsed) {
		return r.getHostLocation()
	}

	// 2. Cache hit: returns instantly in 0ms
	if val, ok := r.cache.Load(cleanIP); ok {
		return val.(GeoLocation)
	}

	// 3. Dynamic resolution from live IP
	loc := r.resolveRemote(cleanIP)
	r.cache.Store(cleanIP, loc)
	return loc
}

type ipAPIResponse struct {
	Status      string  `json:"status"`
	Country     string  `json:"country"`
	CountryCode string  `json:"countryCode"`
	City        string  `json:"city"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
	ISP         string  `json:"isp"`
}

// resolveRemote queries ip-api dynamically for real country, city, coordinates, and ISP.
func (r *GeoIPResolver) resolveRemote(ip string) GeoLocation {
	req, err := http.NewRequest("GET", "http://ip-api.com/json/"+ip+"?fields=status,country,countryCode,city,lat,lon,isp", nil)
	if err == nil {
		req.Header.Set("User-Agent", "BarePod-Panel/1.0")
		resp, err := r.httpClient.Do(req)
		if err == nil && resp.StatusCode == http.StatusOK {
			defer resp.Body.Close()
			var res ipAPIResponse
			if err := json.NewDecoder(resp.Body).Decode(&res); err == nil && res.Status == "success" {
				cc := strings.ToUpper(res.CountryCode)
				flag := CountryFlag(cc)
				x, y := LatLonToXY(res.Lat, res.Lon)
				city := res.City
				if city == "" {
					city = res.Country
				}
				isp := res.ISP
				if isp == "" {
					isp = "Internet Broadband / Cloud"
				}
				return GeoLocation{
					CountryCode: cc,
					CountryName: res.Country,
					City:        city,
					ISP:         isp,
					Lat:         res.Lat,
					Lon:         res.Lon,
					X:           x,
					Y:           y,
					Flag:        flag,
					IsPrivate:   false,
				}
			}
		}
	}

	// Fallback if offline
	x, y := LatLonToXY(0, 0)
	return GeoLocation{
		CountryCode: "UN",
		CountryName: "Global Edge",
		City:        "Internet Node",
		ISP:         "Public Network",
		Lat:         0,
		Lon:         0,
		X:           x,
		Y:           y,
		Flag:        "🌐",
		IsPrivate:   false,
	}
}
