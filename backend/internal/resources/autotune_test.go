package resources

import "testing"

func TestTuneRuntimeScalesAllRuntimesAcrossHostSpecs(t *testing.T) {
	small := TuneRuntime(0, 1024, 1)
	if small.PHPMaxChildren != 5 || small.PHPMemoryMB != 256 || small.PythonWorkers != 2 || small.RubyWorkers != 1 || small.RubyThreads != 3 || small.NodeMaxOldSpaceMB != 256 {
		t.Errorf("unexpected small host tune: %+v", small)
	}

	med := TuneRuntime(0, 4096, 4)
	if med.PHPMaxChildren != 16 || med.PHPMemoryMB != 384 || med.PythonWorkers != 8 || med.RubyWorkers != 4 || med.RubyThreads != 5 || med.NodeMaxOldSpaceMB != 1024 {
		t.Errorf("unexpected medium host tune: %+v", med)
	}

	large := TuneRuntime(0, 7937, 4)
	if large.PHPMaxChildren != 16 || large.PHPMemoryMB != 512 || large.PHPIdleTimeout != "30s" || large.PHPMaxRequests != 1000 || large.PythonWorkers != 9 || large.RubyWorkers != 4 || large.NodeMaxOldSpaceMB != 1984 || large.GoMemLimitMB != 3968 {
		t.Errorf("unexpected 8GB/4vCPU host tune: %+v", large)
	}

	capped := TuneRuntime(512, 7937, 4)
	if capped.PHPMaxChildren != 8 || capped.PHPMemoryMB != 512 || capped.PythonWorkers != 4 || capped.RubyWorkers != 2 || capped.NodeMaxOldSpaceMB != 384 || capped.GoMemLimitMB != 409 {
		t.Errorf("unexpected 512MB package tune: %+v", capped)
	}
}
