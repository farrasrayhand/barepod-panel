//go:build !linux && !darwin

package metrics

import "time"

// unsupportedCollector is used on platforms the daemon does not target.
type unsupportedCollector struct{}

func newCollector(string) Collector { return &unsupportedCollector{} }

// Mode implements Collector.
func (c *unsupportedCollector) Mode() string { return "unsupported" }

// Snapshot implements Collector. It reports the metric as unavailable with a
// reason instead of pretending the machine is idle.
func (c *unsupportedCollector) Snapshot(_ Snapshot, _ time.Duration) (Snapshot, error) {
	return Snapshot{
		TS:        time.Now().UTC().Format(time.RFC3339),
		Available: false,
		Reason:    "host metrics need Linux (/proc) or macOS (sysctl); the daemon targets 64-bit Linux",
	}, nil
}
