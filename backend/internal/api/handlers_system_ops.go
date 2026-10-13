package api

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
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
