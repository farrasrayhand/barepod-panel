package api

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// enginePortCandidates are the ports each engine is found on: the conventional one first, then the
// one the panel's own container publishes. The report is "what this host listens on", measured — the
// settings screen had these written into it, so a host whose PostgreSQL had been moved to 5433 still
// showed 5432, and SSH was not shown at all.
var enginePortCandidates = map[string][]int{
	"postgresql": {5432, 5433},
	"mariadb":    {3306, 3307},
	"redis":      {6379, 6380},
	"mongodb":    {27017, 27018},
}

// handleSystemPorts reports the ports this host is actually listening on. Any signed-in user may read
// it: a port is not a secret, and a screen that shows a wrong one is worse than one that shows none.
func (s *Server) handleSystemPorts(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	listening, err := s.listeningPorts(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, "service_error", err.Error())
		return
	}
	engines := map[string]int{}
	for engine, candidates := range enginePortCandidates {
		for _, port := range candidates {
			if listening[port] {
				engines[engine] = port
				break
			}
		}
	}
	panelPort := 0
	if _, port, err := net.SplitHostPort(s.cfg.Listen); err == nil {
		panelPort, _ = strconv.Atoi(port)
	}
	sshPort := SSHPort()
	if !listening[sshPort] {
		// Not listening where its configuration says: report nothing rather than a number that is not
		// true of this host.
		sshPort = 0
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"panel":   panelPort,
		"ssh":     sshPort,
		"engines": engines,
		"note":    "measured on this host with ss, not written into the screen",
	})
}

// listeningPorts reads the local TCP ports something is bound to.
func (s *Server) listeningPorts(r *http.Request) (map[int]bool, error) {
	out, err := s.host.Run(r.Context(), []string{"ss", "-ltn"})
	if err != nil {
		return nil, fmt.Errorf("could not read the listening ports: %w", err)
	}
	ports := map[int]bool{}
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 || !strings.HasPrefix(fields[0], "LISTEN") {
			continue
		}
		// The local address is "0.0.0.0:5432", "[::]:5432" or "127.0.0.1:5432".
		_, port, err := net.SplitHostPort(fields[3])
		if err != nil {
			continue
		}
		if number, err := strconv.Atoi(port); err == nil {
			ports[number] = true
		}
	}
	return ports, nil
}

// SSHPort reads the port sshd was told to use, and answers 22 when it was told nothing. Exported
// because the lockout closes the door it earned on SSH, and that door is this port — writing 22 into
// the guard would have been one more hardcoded number in a screen that was just cleared of them.
func SSHPort() int {
	body, err := os.ReadFile("/etc/ssh/sshd_config")
	if err != nil {
		return 22
	}
	for _, line := range strings.Split(string(body), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && strings.EqualFold(fields[0], "Port") {
			if port, err := strconv.Atoi(fields[1]); err == nil {
				return port
			}
		}
	}
	return 22
}
