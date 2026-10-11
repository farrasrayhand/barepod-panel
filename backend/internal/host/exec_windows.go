//go:build windows

package host

import (
	"context"
	"errors"
)

// RunAs is not supported on Windows: BarePod targets Linux hosts.
func (RealRunner) RunAs(context.Context, string, string, string, ...string) (string, error) {
	return "", errors.New("host: running a command as another user is only supported on Unix")
}
