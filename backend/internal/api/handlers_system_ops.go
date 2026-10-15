package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/sysinfo"
)

type ProcessItem struct {
	PID      int     `json:"pid"`
	User     string  `json:"user"`
	CPU      float64 `json:"cpu"`
	Mem      float64 `json:"mem"`
	RSS      string  `json:"rss"`
	Threads  int     `json:"threads"`
	Status   string  `json:"status"`
	Command  string  `json:"command"`
	Category string  `json:"category"`
}

type ServiceItem struct {
	Unit        string `json:"unit"`
	Name        string `json:"name"`
	Status      string `json:"status"`
	SubState    string `json:"subState"`
	Description string `json:"description"`
	Category    string `json:"category"`
}

func categorizeCommand(cmd string) string {
	low := strings.ToLower(cmd)
	if strings.Contains(low, "postgres") || strings.Contains(low, "mysql") || strings.Contains(low, "mariadb") ||
		strings.Contains(low, "mongod") || strings.Contains(low, "redis-server") {
		return "database"
	}
	if strings.Contains(low, "nginx") || strings.Contains(low, "litespeed") || strings.Contains(low, "lshttpd") ||
		strings.Contains(low, "apache") || strings.Contains(low, "caddy") || strings.Contains(low, "php-fpm") ||
		strings.Contains(low, "lsphp") || strings.Contains(low, "node") || strings.Contains(low, "gunicorn") ||
		strings.Contains(low, "uvicorn") || strings.Contains(low, "flask") {
		return "web"
	}
	if strings.Contains(low, "docker") || strings.Contains(low, "containerd") {
		return "container"
	}
	return "system"
}

func categorizeService(unit string) string {
	low := strings.ToLower(unit)
	if strings.Contains(low, "postgres") || strings.Contains(low, "mysql") || strings.Contains(low, "mariadb") ||
		strings.Contains(low, "mongo") || strings.Contains(low, "redis") {
		return "database"
	}
	if strings.Contains(low, "nginx") || strings.Contains(low, "litespeed") || strings.Contains(low, "lshttpd") ||
		strings.Contains(low, "apache") || strings.Contains(low, "caddy") || strings.Contains(low, "php") ||
		strings.Contains(low, "barepod-app") {
		return "web"
	}
	if strings.Contains(low, "docker") || strings.Contains(low, "containerd") {
		return "container"
	}
	if strings.Contains(low, "cloudflared") || strings.Contains(low, "tunnel") || strings.Contains(low, "ufw") {
		return "network"
	}
	return "system"
}

func formatRSS(kb uint64) string {
	if kb >= 1024*1024 {
		return fmt.Sprintf("%.1f GB", float64(kb)/(1024*1024))
	}
	if kb >= 1024 {
		return fmt.Sprintf("%.1f MB", float64(kb)/1024)
	}
	return fmt.Sprintf("%d KB", kb)
}

// handleSystemProcesses returns the real running processes on the host.
func (s *Server) handleSystemProcesses(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ps", "-eo", "pid,user,%cpu,%mem,rss,nlwp,stat,args", "--sort=-%cpu")
	out, err := cmd.Output()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "ps_failed", "Failed to retrieve process table: "+err.Error())
		return
	}

	var items []ProcessItem
	scanner := bufio.NewScanner(bytes.NewReader(out))
	isHeader := true

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if isHeader {
			isHeader = false
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 8 {
			continue
		}

		pid, _ := strconv.Atoi(fields[0])
		user := fields[1]
		cpu, _ := strconv.ParseFloat(fields[2], 64)
		mem, _ := strconv.ParseFloat(fields[3], 64)
		rssKb, _ := strconv.ParseUint(fields[4], 10, 64)
		threads, _ := strconv.Atoi(fields[5])
		stat := fields[6]
		command := strings.Join(fields[7:], " ")

		statusLetter := "S"
		if strings.HasPrefix(stat, "R") {
			statusLetter = "R"
		}

		items = append(items, ProcessItem{
			PID:      pid,
			User:     user,
			CPU:      cpu,
			Mem:      mem,
			RSS:      formatRSS(rssKb),
			Threads:  threads,
			Status:   statusLetter,
			Command:  command,
			Category: categorizeCommand(command),
		})

		if len(items) >= 80 {
			break
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items":     items,
		"total":     len(items),
		"checkedAt": time.Now().UTC().Format(time.RFC3339),
	})
}

// handleSystemProcessKill terminates a process by PID.
func (s *Server) handleSystemProcessKill(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	if user.Role != "admin" {
		writeError(w, http.StatusForbidden, "forbidden", "Only system administrators can terminate system processes")
		return
	}
	pidStr := r.PathValue("pid")
	pid, err := strconv.Atoi(pidStr)
	if err != nil || pid <= 1 {
		writeError(w, http.StatusBadRequest, "invalid_pid", "Cannot terminate process with invalid PID")
		return
	}

	var body struct {
		Signal string `json:"signal"`
	}
	_ = decodeJSON(r, &body)

	sig := syscall.SIGTERM
	if strings.ToUpper(body.Signal) == "SIGKILL" {
		sig = syscall.SIGKILL
	}

	if err := syscall.Kill(pid, sig); err != nil {
		writeError(w, http.StatusInternalServerError, "kill_failed", "Failed to send signal: "+err.Error())
		return
	}

	_ = s.store.Audit(user.ID, "system.process_kill", fmt.Sprintf("PID %d", pid), "", string(body.Signal))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "pid": pid})
}

// handleSystemServices lists actual systemd services.
func (s *Server) handleSystemServices(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "systemctl", "list-units", "--type=service", "--no-legend", "--no-pager")
	out, err := cmd.Output()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "systemctl_failed", "Failed to inspect systemd services: "+err.Error())
		return
	}

	var items []ServiceItem
	scanner := bufio.NewScanner(bytes.NewReader(out))

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}

		unit := fields[0]
		active := fields[2]
		sub := fields[3]
		desc := ""
		if len(fields) > 4 {
			desc = strings.Join(fields[4:], " ")
		}

		name := strings.TrimSuffix(unit, ".service")
		low := strings.ToLower(unit)

		// Filter for services relevant to web hosting, database, container, or panel
		isRelevant := strings.HasPrefix(low, "barepod") ||
			strings.Contains(low, "apache") ||
			strings.Contains(low, "caddy") ||
			strings.Contains(low, "nginx") ||
			strings.Contains(low, "litespeed") ||
			strings.Contains(low, "lshttpd") ||
			strings.Contains(low, "mariadb") ||
			strings.Contains(low, "mysql") ||
			strings.Contains(low, "postgres") ||
			strings.Contains(low, "redis") ||
			strings.Contains(low, "mongo") ||
			strings.Contains(low, "docker") ||
			strings.Contains(low, "containerd") ||
			strings.Contains(low, "php") ||
			strings.Contains(low, "ufw") ||
			strings.Contains(low, "cron") ||
			strings.Contains(low, "ssh") ||
			strings.Contains(low, "cloudflared")

		if !isRelevant {
			continue
		}

		items = append(items, ServiceItem{
			Unit:        unit,
			Name:        name,
			Status:      active,
			SubState:    sub,
			Description: desc,
			Category:    categorizeService(unit),
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items":     items,
		"total":     len(items),
		"checkedAt": time.Now().UTC().Format(time.RFC3339),
	})
}

// handleSystemServiceAction performs start, stop, or restart on a service unit.
func (s *Server) handleSystemServiceAction(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	if user.Role != "admin" {
		writeError(w, http.StatusForbidden, "forbidden", "Only system administrators can control system services")
		return
	}
	unit := r.PathValue("unit")
	if !strings.HasSuffix(unit, ".service") {
		unit += ".service"
	}

	// Validate unit name characters strictly
	for _, c := range unit {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '-' || c == '_' || c == '@') {
			writeError(w, http.StatusBadRequest, "invalid_unit", "Service unit contains invalid characters")
			return
		}
	}

	var body struct {
		Action string `json:"action"` // "start", "stop", "restart"
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid action payload")
		return
	}

	action := strings.ToLower(body.Action)
	if action != "start" && action != "stop" && action != "restart" {
		writeError(w, http.StatusBadRequest, "invalid_action", "Action must be start, stop, or restart")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "systemctl", action, unit)
	if out, err := cmd.CombinedOutput(); err != nil {
		writeError(w, http.StatusInternalServerError, "systemctl_error", fmt.Sprintf("Failed to %s %s: %s", action, unit, strings.TrimSpace(string(out))))
		return
	}

	_ = s.store.Audit(user.ID, "system.service_"+action, unit, "", "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "unit": unit, "action": action})
}

// handleSystemServiceLogs returns recent journalctl logs for a unit.
func (s *Server) handleSystemServiceLogs(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	unit := r.PathValue("unit")
	if !strings.HasSuffix(unit, ".service") {
		unit += ".service"
	}
	// Validate unit name characters strictly
	for _, c := range unit {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '-' || c == '_' || c == '@') {
			writeError(w, http.StatusBadRequest, "invalid_unit", "Service unit contains invalid characters")
			return
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "journalctl", "-u", unit, "-n", "60", "--no-pager")
	out, err := cmd.CombinedOutput()
	if err != nil && len(out) == 0 {
		writeError(w, http.StatusInternalServerError, "journalctl_failed", "Failed to retrieve logs: "+err.Error())
		return
	}

	raw := strings.TrimSpace(string(out))
	var lines []string
	if raw != "" {
		lines = strings.Split(raw, "\n")
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"unit":  unit,
		"lines": lines,
		"total": len(lines),
	})
}

type StorageMount struct {
	MountPoint   string `json:"mountPoint"`
	Filesystem   string `json:"filesystem"`
	FSType       string `json:"fsType"`
	TotalBytes   uint64 `json:"totalBytes"`
	UsedBytes    uint64 `json:"usedBytes"`
	AvailBytes   uint64 `json:"availBytes"`
	UsagePercent int    `json:"usagePercent"`
	Inodes       string `json:"inodes"`
}

type StorageDisk struct {
	Name    string `json:"name"`
	Size    string `json:"size"`
	Type    string `json:"type"`
	Model   string `json:"model"`
	Mounted string `json:"mounted"`
}

// handleSystemStorage reports real filesystem mounts and block devices on the host.
func (s *Server) handleSystemStorage(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// 1. Inodes map from df -Pi
	inodesMap := make(map[string]string)
	if inodeOut, err := exec.CommandContext(ctx, "df", "-Pi").Output(); err == nil {
		scanner := bufio.NewScanner(bytes.NewReader(inodeOut))
		isH := true
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if isH {
				isH = false
				continue
			}
			f := strings.Fields(line)
			if len(f) >= 6 {
				inodesMap[f[5]] = fmt.Sprintf("%s / %s (%s)", f[2], f[1], f[4])
			}
		}
	}

	// 2. df -PTB1 for real block mounts
	var mounts []StorageMount
	if dfOut, err := exec.CommandContext(ctx, "df", "-PTB1").Output(); err == nil {
		scanner := bufio.NewScanner(bytes.NewReader(dfOut))
		isH := true
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if isH {
				isH = false
				continue
			}
			f := strings.Fields(line)
			if len(f) < 7 {
				continue
			}
			fs := f[0]
			fsType := f[1]
			total, _ := strconv.ParseUint(f[2], 10, 64)
			used, _ := strconv.ParseUint(f[3], 10, 64)
			avail, _ := strconv.ParseUint(f[4], 10, 64)
			capStr := strings.TrimSuffix(f[5], "%")
			capPct, _ := strconv.Atoi(capStr)
			mountPt := f[6]

			// Filter tiny virtual pseudo filesystems (e.g. efivarfs with ~300KB)
			if total < 10*1024*1024 && fsType != "ext4" && fsType != "xfs" && fsType != "btrfs" {
				continue
			}

			mounts = append(mounts, StorageMount{
				MountPoint:   mountPt,
				Filesystem:   fs,
				FSType:       fsType,
				TotalBytes:   total,
				UsedBytes:    used,
				AvailBytes:   avail,
				UsagePercent: capPct,
				Inodes:       inodesMap[mountPt],
			})
		}
	}

	// 3. Physical / Virtual block devices from lsblk
	var disks []StorageDisk
	if lsblkOut, err := exec.CommandContext(ctx, "lsblk", "-r", "-n", "-o", "NAME,SIZE,TYPE,MOUNTPOINT,MODEL").Output(); err == nil {
		scanner := bufio.NewScanner(bytes.NewReader(lsblkOut))
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			f := strings.Fields(line)
			if len(f) >= 3 {
				name := f[0]
				size := f[1]
				dType := f[2]
				mounted := ""
				model := ""
				if len(f) >= 4 && strings.HasPrefix(f[3], "/") {
					mounted = f[3]
					if len(f) >= 5 {
						model = strings.ReplaceAll(strings.Join(f[4:], " "), `\x20`, " ")
					}
				} else if len(f) >= 4 {
					model = strings.ReplaceAll(strings.Join(f[3:], " "), `\x20`, " ")
				}
				model = strings.TrimSpace(model)

				disks = append(disks, StorageDisk{
					Name:    name,
					Size:    size,
					Type:    dType,
					Model:   model,
					Mounted: mounted,
				})
			}
		}
	}

	caps := sysinfo.Detect()
	smartSupported := caps.Smart
	smartMessage := ""
	if !smartSupported {
		if caps.LXC {
			smartMessage = "Direct S.M.A.R.T. raw register access is restricted by the container hypervisor (LXC/PVE). Drive health & wear are monitored by the Proxmox host. Filesystem quotas and block stats are active."
		} else {
			smartMessage = "smartmontools is not installed or no raw ATA/NVMe devices were found."
		}
	} else {
		smartMessage = "Physical storage devices detected. S.M.A.R.T. diagnostics available."
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"mounts":         mounts,
		"disks":          disks,
		"smartSupported": smartSupported,
		"smartMessage":   smartMessage,
	})
}

type NetInterface struct {
	Name      string `json:"name"`
	State     string `json:"state"`
	MAC       string `json:"mac"`
	IPv4      string `json:"ipv4"`
	IPv6      string `json:"ipv6"`
	MTU       int    `json:"mtu"`
	RxBytes   uint64 `json:"rxBytes"`
	TxBytes   uint64 `json:"txBytes"`
	RxPackets uint64 `json:"rxPackets"`
	TxPackets uint64 `json:"txPackets"`
	RxErrors  uint64 `json:"rxErrors"`
	TxErrors  uint64 `json:"txErrors"`
	RxDrops   uint64 `json:"rxDrops"`
	TxDrops   uint64 `json:"txDrops"`
}

type SocketPort struct {
	Proto     string `json:"proto"`
	Port      int    `json:"port"`
	LocalAddr string `json:"localAddr"`
	Process   string `json:"process"`
	Pid       int    `json:"pid"`
	Status    string `json:"status"`
}

type SocketSummary struct {
	Established int `json:"established"`
	TimeWait    int `json:"timeWait"`
	CloseWait   int `json:"closeWait"`
	Listen      int `json:"listen"`
	Total       int `json:"total"`
}

// handleSystemNetwork reports real network interfaces, socket stats, and listening ports.
func (s *Server) handleSystemNetwork(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// 1. Parse /proc/net/dev for interface stats
	devStats := make(map[string]struct {
		rxBytes, txBytes     uint64
		rxPackets, txPackets uint64
		rxErrors, txErrors   uint64
		rxDrops, txDrops     uint64
	})
	if netDev, err := os.ReadFile("/proc/net/dev"); err == nil {
		scanner := bufio.NewScanner(bytes.NewReader(netDev))
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if strings.Contains(line, ":") {
				parts := strings.SplitN(line, ":", 2)
				iface := strings.TrimSpace(parts[0])
				fields := strings.Fields(parts[1])
				if len(fields) >= 16 {
					rxB, _ := strconv.ParseUint(fields[0], 10, 64)
					rxP, _ := strconv.ParseUint(fields[1], 10, 64)
					rxE, _ := strconv.ParseUint(fields[2], 10, 64)
					rxD, _ := strconv.ParseUint(fields[3], 10, 64)
					txB, _ := strconv.ParseUint(fields[8], 10, 64)
					txP, _ := strconv.ParseUint(fields[9], 10, 64)
					txE, _ := strconv.ParseUint(fields[10], 10, 64)
					txD, _ := strconv.ParseUint(fields[11], 10, 64)
					devStats[iface] = struct {
						rxBytes, txBytes     uint64
						rxPackets, txPackets uint64
						rxErrors, txErrors   uint64
						rxDrops, txDrops     uint64
					}{rxB, txB, rxP, txP, rxE, txE, rxD, txD}
				}
			}
		}
	}

	// 2. Parse ip -j addr
	var interfaces []NetInterface
	if ipOut, err := exec.CommandContext(ctx, "ip", "-j", "addr").Output(); err == nil {
		var ipAddrs []struct {
			Ifname    string `json:"ifname"`
			Operstate string `json:"operstate"`
			Mtu       int    `json:"mtu"`
			Address   string `json:"address"`
			AddrInfo  []struct {
				Family    string `json:"family"`
				Local     string `json:"local"`
				Prefixlen int    `json:"prefixlen"`
			} `json:"addr_info"`
		}
		if err := json.Unmarshal(ipOut, &ipAddrs); err == nil {
			for _, item := range ipAddrs {
				ipv4 := ""
				ipv6 := ""
				for _, a := range item.AddrInfo {
					if a.Family == "inet" && ipv4 == "" {
						ipv4 = fmt.Sprintf("%s/%d", a.Local, a.Prefixlen)
					} else if a.Family == "inet6" && ipv6 == "" {
						ipv6 = fmt.Sprintf("%s/%d", a.Local, a.Prefixlen)
					}
				}
				st := devStats[item.Ifname]
				oper := strings.ToUpper(item.Operstate)
				if oper == "UNKNOWN" && item.Ifname == "lo" {
					oper = "UP"
				}
				interfaces = append(interfaces, NetInterface{
					Name:      item.Ifname,
					State:     oper,
					MAC:       item.Address,
					IPv4:      ipv4,
					IPv6:      ipv6,
					MTU:       item.Mtu,
					RxBytes:   st.rxBytes,
					TxBytes:   st.txBytes,
					RxPackets: st.rxPackets,
					TxPackets: st.txPackets,
					RxErrors:  st.rxErrors,
					TxErrors:  st.txErrors,
					RxDrops:   st.rxDrops,
					TxDrops:   st.txDrops,
				})
			}
		}
	}

	// 3. Parse listening ports via ss -tulpnH
	var ports []SocketPort
	listenCount := 0
	if ssOut, err := exec.CommandContext(ctx, "ss", "-tulpnH").Output(); err == nil {
		scanner := bufio.NewScanner(bytes.NewReader(ssOut))
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			f := strings.Fields(line)
			if len(f) < 5 {
				continue
			}
			proto := f[0]
			state := f[1]
			local := f[4]
			if state == "LISTEN" {
				listenCount++
			}

			port := 0
			if idx := strings.LastIndex(local, ":"); idx != -1 {
				port, _ = strconv.Atoi(local[idx+1:])
			}

			proc := ""
			pid := 0
			if uIdx := strings.Index(line, `users:(("`); uIdx != -1 {
				after := line[uIdx+len(`users:(("`):]
				if qIdx := strings.Index(after, `"`); qIdx != -1 {
					proc = after[:qIdx]
				}
				if pIdx := strings.Index(after, `pid=`); pIdx != -1 {
					pStr := after[pIdx+4:]
					endP := strings.IndexAny(pStr, ",)")
					if endP != -1 {
						pid, _ = strconv.Atoi(pStr[:endP])
					}
				}
			}

			ports = append(ports, SocketPort{
				Proto:     proto,
				Port:      port,
				LocalAddr: local,
				Process:   proc,
				Pid:       pid,
				Status:    state,
			})
		}
	}

	// 4. Parse ss -s for TCP stats
	var summary SocketSummary
	summary.Listen = listenCount
	if sOut, err := exec.CommandContext(ctx, "ss", "-s").Output(); err == nil {
		scanner := bufio.NewScanner(bytes.NewReader(sOut))
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "TCP:") {
				if idx := strings.Index(line, "estab "); idx != -1 {
					sub := line[idx+6:]
					if end := strings.IndexAny(sub, ", )"); end != -1 {
						summary.Established, _ = strconv.Atoi(sub[:end])
					}
				}
				if idx := strings.Index(line, "timewait "); idx != -1 {
					sub := line[idx+9:]
					if end := strings.IndexAny(sub, ", )"); end != -1 {
						summary.TimeWait, _ = strconv.Atoi(sub[:end])
					}
				}
			}
			if strings.HasPrefix(line, "Total:") {
				f := strings.Fields(line)
				if len(f) >= 2 {
					summary.Total, _ = strconv.Atoi(f[1])
				}
			}
		}
	}

	// 5. Default gateway
	gateway := ""
	if gwOut, err := exec.CommandContext(ctx, "ip", "route", "show", "default").Output(); err == nil {
		f := strings.Fields(string(gwOut))
		for i, w := range f {
			if w == "via" && i+1 < len(f) {
				gateway = f[i+1]
				break
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"interfaces":    interfaces,
		"ports":         ports,
		"socketSummary": summary,
		"gateway":       gateway,
	})
}

// handleSystemPing runs live ICMP ping latency probes to Edge DNS and gateway.
func (s *Server) handleSystemPing(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	gateway := "172.19.1.1"
	if gwOut, err := exec.CommandContext(ctx, "ip", "route", "show", "default").Output(); err == nil {
		f := strings.Fields(string(gwOut))
		for i, w := range f {
			if w == "via" && i+1 < len(f) {
				gateway = f[i+1]
				break
			}
		}
	}

	runPing := func(target string) string {
		cmd := exec.CommandContext(ctx, "ping", "-c", "1", "-W", "2", target)
		out, err := cmd.CombinedOutput()
		if err != nil {
			return "timeout"
		}
		scanner := bufio.NewScanner(bytes.NewReader(out))
		for scanner.Scan() {
			line := scanner.Text()
			if strings.Contains(line, "time=") {
				parts := strings.Split(line, "time=")
				if len(parts) > 1 {
					return strings.TrimSpace(strings.Split(parts[1], " ")[0]) + " ms"
				}
			}
		}
		return "ok"
	}

	cfLatency := runPing("1.1.1.1")
	googleLatency := runPing("8.8.8.8")
	gwLatency := runPing(gateway)

	writeJSON(w, http.StatusOK, map[string]any{
		"cloudflare": cfLatency,
		"google":     googleLatency,
		"gateway":    gwLatency,
		"gatewayIp":  gateway,
	})
}
