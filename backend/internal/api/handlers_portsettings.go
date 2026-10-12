package api

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// Changing a port from the panel is a change to the host's own configuration, so both handlers below
// work the same way: validate first, keep a copy of what was there, write, verify, and put the copy
// back if the verification fails. A panel that broke sshd while trying to tidy a port would be a
// worse panel than one that cannot change ports at all.

const sshdConfigPath = "/etc/ssh/sshd_config"

// handleSetPanelPort moves the panel to another port by rewriting the flag its unit starts with.
//
// The daemon cannot change the port it is already listening on; what it can do is change the file
// that decides it next time, answer the operator, and then ask systemd — without blocking — to
// restart the unit. The answer arrives before the restart, because the restart is this process
// ending.
func (s *Server) handleSetPanelPort(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var body struct {
		Port int `json:"port"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "could not read the port")
		return
	}
	if reason := validatePort(r, body.Port, currentPanelPort(s)); reason != "" {
		writeError(w, http.StatusBadRequest, "invalid_port", reason)
		return
	}
	if holder := s.portHolder(r.Context(), body.Port); holder != "" {
		writeError(w, http.StatusConflict, "port_in_use", fmt.Sprintf(
			"port %d is already held by %s, so moving the panel there would break both. Pick another.", body.Port, holder))
		return
	}
	unit := filepath.Join(s.cfg.UnitsDir, "barepod.service")
	original, err := os.ReadFile(unit)
	if err != nil {
		writeError(w, http.StatusConflict, "not_managed",
			"this daemon was not started by a unit this panel can edit ("+unit+"): "+err.Error())
		return
	}
	updated, err := replaceListenPort(string(original), body.Port)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_unit", err.Error())
		return
	}
	if err := os.WriteFile(unit+".barepod-backup", original, 0o644); err != nil {
		writeError(w, http.StatusInternalServerError, "io_error", err.Error())
		return
	}
	if err := os.WriteFile(unit, []byte(updated), 0o644); err != nil {
		writeError(w, http.StatusInternalServerError, "io_error", err.Error())
		return
	}
	if out, err := s.host.Run(r.Context(), []string{"systemctl", "daemon-reload"}); err != nil {
		_ = os.WriteFile(unit, original, 0o644)
		writeError(w, http.StatusBadGateway, "service_error",
			"the unit was put back: systemd refused the change ("+strings.TrimSpace(out)+")")
		return
	}
	_ = s.store.Audit(user.ID, "panel.port", "listen", clientIP(r),
		fmt.Sprintf("%d -> %d", currentPanelPort(s), body.Port))
	writeJSON(w, http.StatusOK, map[string]any{
		"port": body.Port,
		"note": fmt.Sprintf("The panel is restarting on port %d. Open it there — this page will stop answering. The unit's previous contents are in %s.barepod-backup.", body.Port, unit),
	})
	// Last, and without blocking: asking systemd to restart this unit is asking it to end this
	// process, so the reply has already been written and the caller has already read it.
	_, _ = s.host.Run(r.Context(), []string{"systemctl", "restart", "--no-block", "barepod"})
}

// handleSetSSHPort adds or removes a port sshd listens on. Adding keeps the old one, so a mistake
// costs nothing: the way in is still open until the operator removes it, deliberately, after seeing
// the new port work.
func (s *Server) handleSetSSHPort(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var body struct {
		Port   int    `json:"port"`
		Remove bool   `json:"remove"`
		Action string `json:"action"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "could not read the port")
		return
	}
	remove := body.Remove || strings.EqualFold(body.Action, "remove")
	// Adding a port sshd is already told to use changes nothing, so only a genuinely new one is checked
	// — against everything listening, not only against the panel: a collision with PostgreSQL would be
	// just as fatal and much harder to understand.
	if !sshdPortConfigured(body.Port) {
		if holder := s.portHolder(r.Context(), body.Port); holder != "" {
			writeError(w, http.StatusConflict, "port_in_use", fmt.Sprintf(
				"port %d is already held by %s. Pick another.", body.Port, holder))
			return
		}
	}
	original, err := os.ReadFile(sshdConfigPath)
	if err != nil {
		writeError(w, http.StatusConflict, "not_found", "this host has no "+sshdConfigPath)
		return
	}
	updated, err := editSSHPorts(string(original), body.Port, remove)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_change", err.Error())
		return
	}
	if err := os.WriteFile(sshdConfigPath+".barepod-backup", original, 0o644); err != nil {
		writeError(w, http.StatusInternalServerError, "io_error", err.Error())
		return
	}
	if err := os.WriteFile(sshdConfigPath, []byte(updated), 0o644); err != nil {
		writeError(w, http.StatusInternalServerError, "io_error", err.Error())
		return
	}
	// sshd -t is the only opinion that matters here: a configuration it refuses is one that would
	// have taken SSH away at the next reload.
	if out, err := s.host.Run(r.Context(), []string{"sshd", "-t"}); err != nil {
		_ = os.WriteFile(sshdConfigPath, original, 0o644)
		writeError(w, http.StatusBadGateway, "invalid_config",
			"sshd refused it, so the file was put back: "+strings.TrimSpace(out))
		return
	}
	reloadOut, reloadErr := s.host.Run(r.Context(), []string{"systemctl", "reload", "ssh"})
	if reloadErr != nil {
		_ = os.WriteFile(sshdConfigPath, original, 0o644)
		_, _ = s.host.Run(r.Context(), []string{"systemctl", "reload", "ssh"})
		writeError(w, http.StatusBadGateway, "service_error",
			"sshd did not reload, so the file was put back: "+strings.TrimSpace(reloadOut))
		return
	}
	verb := "added to"
	if remove {
		verb = "removed from"
	}
	_ = s.store.Audit(user.ID, "panel.ssh_port", "sshd", clientIP(r),
		fmt.Sprintf("port %d %s sshd's configuration", body.Port, verb))
	note := fmt.Sprintf("Port %d was %s sshd. The old port is untouched, so the way in is unchanged; remove it once the new one answers.", body.Port, verb)
	if remove {
		note = fmt.Sprintf("Port %d was removed from sshd. Check that you can still reach the host before closing this.", body.Port)
	}
	writeJSON(w, http.StatusOK, map[string]any{"port": body.Port, "removed": remove, "note": note, "ports": sshdConfiguredPorts()})
}

// replaceListenPort rewrites the port in the unit's -listen flag, which is where the daemon's port
// actually comes from.
func replaceListenPort(unit string, port int) (string, error) {
	lines := strings.Split(unit, "\n")
	for i, line := range lines {
		if !strings.Contains(line, "-listen") {
			continue
		}
		// Only the port token is replaced, and the line is put back together unchanged: an earlier
		// version of this dropped the program's own path from ExecStart and produced a unit that could
		// not start at all — the test written with it is what caught that.
		fields := strings.Fields(line)
		for j, field := range fields {
			if field != "-listen" || j+1 >= len(fields) {
				continue
			}
			host, _, err := net.SplitHostPort(fields[j+1])
			if err != nil {
				host = "0.0.0.0"
			}
			fields[j+1] = net.JoinHostPort(host, strconv.Itoa(port))
			lines[i] = strings.Join(fields, " ")
			return strings.Join(lines, "\n"), nil
		}
	}
	return "", fmt.Errorf("this unit does not start the daemon with a -listen flag, so its port cannot be changed from here")
}

// editSSHPorts adds a Port line, or removes one. It refuses to remove the last one: sshd with no Port
// line uses 22, but a deliberate removal that leaves the operator with no idea which port answers is
// not a change worth making silently.
func editSSHPorts(config string, port int, remove bool) (string, error) {
	if port < 1 || port > 65535 {
		return "", fmt.Errorf("a port is between 1 and 65535")
	}
	lines := strings.Split(strings.TrimRight(config, "\n"), "\n")
	out := []string{}
	found := false
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) == 2 && strings.EqualFold(fields[0], "Port") {
			if existing, err := strconv.Atoi(fields[1]); err == nil && existing == port {
				found = true
				if remove {
					continue
				}
			}
		}
		out = append(out, line)
	}
	if !found && !remove {
		out = append(out, "Port "+strconv.Itoa(port))
	}
	if remove && !found {
		return "", fmt.Errorf("sshd is not configured to listen on port %d", port)
	}
	if remove {
		remaining := 0
		for _, line := range out {
			fields := strings.Fields(line)
			if len(fields) == 2 && strings.EqualFold(fields[0], "Port") {
				remaining++
			}
		}
		if remaining == 0 && port != 22 {
			return "", fmt.Errorf("that is the last port sshd would listen on; leave one, or make it 22 first")
		}
	}
	return strings.Join(out, "\n") + "\n", nil
}

// sshdConfiguredPorts lists what sshd was told, for the answer a screen shows back.
func sshdConfiguredPorts() []int {
	body, err := os.ReadFile(sshdConfigPath)
	if err != nil {
		return []int{}
	}
	ports := []int{}
	for _, line := range strings.Split(string(body), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && strings.EqualFold(fields[0], "Port") {
			if port, err := strconv.Atoi(fields[1]); err == nil {
				ports = append(ports, port)
			}
		}
	}
	return ports
}

// currentPanelPort is the port this daemon was started on.
func currentPanelPort(s *Server) int {
	if _, port, err := net.SplitHostPort(s.cfg.Listen); err == nil {
		if parsed, err := strconv.Atoi(port); err == nil {
			return parsed
		}
	}
	return 0
}

// validatePort refuses a port that is not a port, is the one already in use, or is someone else's.
func validatePort(r *http.Request, port, current int) string {
	if port < 1 || port > 65535 {
		return "a port is between 1 and 65535"
	}
	if port == current {
		return "that is the port the panel is already using"
	}
	if port < 1024 {
		return "ports below 1024 need root and are best left to the system"
	}
	return ""
}

// portHolder names what is listening on a port, so a refusal can say who holds it instead of only that
// somebody does. `ss -ltnp` is asked because it already knows: the alternative is a bind attempt, which
// answers "used" but never "by what", and an operator reading "port already in use" has to go and find
// out which of a dozen services on this host it was.
func (s *Server) portHolder(ctx context.Context, port int) string {
	out, err := s.host.Run(ctx, []string{"ss", "-ltnp"})
	if err != nil {
		return ""
	}
	return parsePortHolder(out, port)
}

// parsePortHolder reads the process name for one port out of `ss -ltnp`, e.g.
//
//	LISTEN 0 511 127.0.0.1:6379 0.0.0.0:* users:(("redis-server",pid=1,fd=6))
//
// and returns "" when nothing is listening there. Kept pure so the parsing is testable without a host.
func parsePortHolder(ssOutput string, port int) string {
	suffix := ":" + strconv.Itoa(port)
	for _, line := range strings.Split(ssOutput, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 || !strings.HasPrefix(fields[0], "LISTEN") {
			continue
		}
		held := false
		for _, field := range fields[3:5] { // local address, then peer address
			if strings.HasSuffix(field, suffix) {
				held = true
				break
			}
		}
		if !held {
			continue
		}
		if i := strings.Index(line, "users:((\""); i != -1 {
			rest := line[i+len("users:((\""):]
			if j := strings.Index(rest, "\""); j != -1 {
				return rest[:j]
			}
		}
		return "another service"
	}
	return ""
}

// sshdPortConfigured says whether sshd is already told to listen on that port, in which case asking for
// it changes nothing and must not be refused as a collision with sshd itself.
func sshdPortConfigured(port int) bool {
	for _, configured := range sshdConfiguredPorts() {
		if configured == port {
			return true
		}
	}
	return false
}
