package metrics

import (
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// DaemonSnapshot is the panel process's own footprint. It is deliberately
// separate from host metrics: RSS answers "how much does this process cost the
// OS", while HeapAlloc answers "how much is Go holding after the last GC".
type DaemonSnapshot struct {
	TS string `json:"ts"`

	RSSBytes       uint64 `json:"rssBytes"`
	HeapAllocBytes uint64 `json:"heapAllocBytes"`
	HeapInuseBytes uint64 `json:"heapInuseBytes"`
	HeapSysBytes   uint64 `json:"heapSysBytes"`
	Goroutines     int    `json:"goroutines"`
	FDs            int    `json:"fds"`
}

// SampleDaemon reads the current process without touching the panel database.
// Reading /proc is Linux-only, which is the only platform the daemon serves;
// other platforms simply report zero RSS/FDs and keep the Go heap numbers.
func SampleDaemon() DaemonSnapshot {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	return DaemonSnapshot{
		TS:             time.Now().UTC().Format(time.RFC3339),
		RSSBytes:       processRSSBytes(),
		HeapAllocBytes: mem.HeapAlloc,
		HeapInuseBytes: mem.HeapInuse,
		HeapSysBytes:   mem.HeapSys,
		Goroutines:     runtime.NumGoroutine(),
		FDs:            processFDs(),
	}
}

func processRSSBytes() uint64 {
	raw, err := os.ReadFile("/proc/self/statm")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(raw))
	if len(fields) < 2 {
		return 0
	}
	pages, err := strconv.ParseUint(fields[1], 10, 64)
	if err != nil {
		return 0
	}
	return pages * uint64(os.Getpagesize())
}

func processFDs() int {
	entries, err := os.ReadDir("/proc/self/fd")
	if err != nil {
		return 0
	}
	return len(entries)
}
