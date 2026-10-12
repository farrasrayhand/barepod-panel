package api

import (
	"strings"
	"testing"
)

// The unit's -listen flag is where the daemon's port actually comes from, so that is what a port change
// rewrites — and it rewrites the port alone, leaving the rest of the command line intact.
func TestChangingThePanelPortRewritesOnlyThePort(t *testing.T) {
	unit := "[Service]\nExecStart=/usr/local/bin/barepod serve -listen 0.0.0.0:8443 -db /var/lib/barepod/barepod.db\n"
	out, err := replaceListenPort(unit, 9443)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "-listen 0.0.0.0:9443") || !strings.Contains(out, "-db /var/lib/barepod/barepod.db") {
		t.Errorf("the unit was not rewritten as expected: %s", out)
	}
	if _, err := replaceListenPort("[Service]\nExecStart=/bin/true\n", 9443); err == nil {
		t.Error("a unit with no -listen flag should be refused, not silently accepted")
	}
}

// SSH's port moves in two steps on purpose: add one while the old still answers, and remove the old
// only once the new is known to work. Removing the last one is refused, because that is how an
// operator ends up with no way in and no idea which port answers.
func TestSSHPortsAreAddedAndRemovedSafely(t *testing.T) {
	added, err := editSSHPorts("PasswordAuthentication no\n", 2222, false)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(added, "Port 2222") {
		t.Errorf("the port was not added: %s", added)
	}
	both, err := editSSHPorts("Port 22\nPasswordAuthentication no\n", 2222, false)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(both, "Port 22") || !strings.Contains(both, "Port 2222") {
		t.Errorf("adding must keep the old port: %s", both)
	}
	// Removing 22 as the last line is allowed, and harmless: sshd with no Port line listens on 22
	// anyway, so the outcome is the same. Removing a last port that is *not* the default is refused,
	// because that is how an operator ends up with no idea which port answers.
	if _, err := editSSHPorts("Port 22\n", 22, true); err != nil {
		t.Errorf("removing 22 as the last port is harmless and should be allowed: %v", err)
	}
	if _, err := editSSHPorts("Port 2222\n", 2222, true); err == nil {
		t.Error("removing the last non-default port should be refused")
	}
	if _, err := editSSHPorts("Port 22\n", 9999, true); err == nil {
		t.Error("removing a port sshd does not listen on should be refused")
	}
	only, err := editSSHPorts("Port 22\nPort 2222\n", 22, true)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(only, "Port 22\n") || !strings.Contains(only, "Port 2222") {
		t.Errorf("removing one port took the wrong one: %s", only)
	}
}
