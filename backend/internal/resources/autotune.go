package resources

// RuntimeTune holds auto-tuned worker, thread, and memory settings for all
// supported runtimes, derived from either the tenant's package memory cap or
// the host's live CPU/RAM specifications.
type RuntimeTune struct {
	// PHP-FPM
	PHPMaxChildren int
	PHPMemoryMB    int
	PHPIdleTimeout string
	PHPMaxRequests int

	// Python (Gunicorn / Uvicorn)
	PythonWorkers int

	// Ruby (Puma)
	RubyWorkers int
	RubyThreads int

	// Node.js (V8 --max-old-space-size)
	NodeMaxOldSpaceMB int

	// Go (GOMEMLIMIT)
	GoMemLimitMB int
}

// DetectRuntimeTune computes auto-tuned settings using the current host's
// detected RAM and CPU cores, bounded by pkgMemoryMB when > 0.
func DetectRuntimeTune(pkgMemoryMB int) RuntimeTune {
	return TuneRuntime(pkgMemoryMB, DetectMemoryMB(), DetectCPUCores())
}

// TuneRuntime computes auto-tuned settings for every runtime from explicit
// package and host specifications.
func TuneRuntime(pkgMemoryMB, hostMemoryMB, hostCPUCores int) RuntimeTune {
	if pkgMemoryMB > 0 {
		phpChildren := clampInt(pkgMemoryMB/64, 2, 20)
		phpIdle := "10s"
		if pkgMemoryMB >= 1024 {
			phpIdle = "20s"
		}
		rubyThreads := 3
		if pkgMemoryMB >= 1024 {
			rubyThreads = 5
		}
		return RuntimeTune{
			PHPMaxChildren:    phpChildren,
			PHPMemoryMB:       pkgMemoryMB,
			PHPIdleTimeout:    phpIdle,
			PHPMaxRequests:    500,
			PythonWorkers:     clampInt(pkgMemoryMB/128, 1, 8),
			RubyWorkers:       clampInt(pkgMemoryMB/256, 1, 4),
			RubyThreads:       rubyThreads,
			NodeMaxOldSpaceMB: clampInt(pkgMemoryMB*3/4, 128, 4096),
			GoMemLimitMB:      clampInt(pkgMemoryMB*4/5, 64, 4096),
		}
	}

	if hostMemoryMB <= 0 || hostCPUCores <= 0 {
		return RuntimeTune{
			PHPMaxChildren:    10,
			PHPMemoryMB:       256,
			PHPIdleTimeout:    "10s",
			PHPMaxRequests:    500,
			PythonWorkers:     4,
			RubyWorkers:       2,
			RubyThreads:       5,
			NodeMaxOldSpaceMB: 512,
			GoMemLimitMB:      512,
		}
	}

	phpChildren := clampInt(minInt(hostMemoryMB/256, hostCPUCores*4), 5, 32)
	phpMem := 256
	phpIdle := "10s"
	phpMaxReq := 500
	if hostMemoryMB >= 6144 {
		phpMem = 512
		phpIdle = "30s"
		phpMaxReq = 1000
	} else if hostMemoryMB >= 2048 {
		phpMem = 384
		phpIdle = "20s"
		if hostMemoryMB >= 4096 {
			phpMaxReq = 1000
		}
	}

	pythonWorkers := clampInt(minInt(hostCPUCores*2+1, hostMemoryMB/512), 2, 16)
	rubyWorkers := clampInt(minInt(hostCPUCores, hostMemoryMB/512), 1, 8)
	rubyThreads := 5
	if hostMemoryMB < 2048 {
		rubyThreads = 3
	}

	return RuntimeTune{
		PHPMaxChildren:    phpChildren,
		PHPMemoryMB:       phpMem,
		PHPIdleTimeout:    phpIdle,
		PHPMaxRequests:    phpMaxReq,
		PythonWorkers:     pythonWorkers,
		RubyWorkers:       rubyWorkers,
		RubyThreads:       rubyThreads,
		NodeMaxOldSpaceMB: clampInt(hostMemoryMB/4, 256, 2048),
		GoMemLimitMB:      clampInt(hostMemoryMB/2, 256, 4096),
	}
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
