//go:build !windows

package host

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"strconv"
	"syscall"
)

// RunAs implements Runner: the command runs with the tenant's UID/GID and HOME.
//
// A deploy used to run everything as root, which left files the tenant could not
// write — a scaffolded `.venv`, a cloned repository — even though the app itself
// runs as the tenant. Running the commands as their owner avoids that instead of
// repairing it afterwards.
func (RealRunner) RunAs(ctx context.Context, username, dir, name string, args ...string) (string, error) {
	account, err := user.Lookup(username)
	if err != nil {
		return "", fmt.Errorf("host: no such user %q: %w", username, err)
	}
	uid, err := strconv.Atoi(account.Uid)
	if err != nil {
		return "", fmt.Errorf("host: unusable uid for %q: %w", username, err)
	}
	gid, err := strconv.Atoi(account.Gid)
	if err != nil {
		return "", fmt.Errorf("host: unusable gid for %q: %w", username, err)
	}

	cmd := exec.CommandContext(ctx, name, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	// Frameworks resolve their caches from HOME (pip, npm, composer), so pass
	// the tenant's environment instead of root's.
	cmd.Env = append(os.Environ(),
		"HOME="+account.HomeDir,
		"USER="+username,
		"LOGNAME="+username,
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Credential: &syscall.Credential{Uid: uint32(uid), Gid: uint32(gid)},
	}

	out, err := cmd.CombinedOutput()
	return string(out), err
}
