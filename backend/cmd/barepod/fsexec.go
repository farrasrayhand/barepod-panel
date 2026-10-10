package main

import (
	"io"
	"os"

	"github.com/farrasrayhand/barepod-panel/backend/internal/files"
)

// runFSExec is the hidden helper command. The daemon starts `barepod fs-exec`
// with the tenant's UID/GID (see internal/files.HelperOps) and sends one file
// operation as JSON on stdin; the answer comes back on stdout.
//
// Running the operation in a child process holding the tenant's credentials is
// what makes the isolation real: the kernel applies the tenant's own
// permissions, and files created through the panel belong to the tenant instead
// of root.
func runFSExec() error {
	payload, err := io.ReadAll(io.LimitReader(os.Stdin, 64<<20))
	if err != nil {
		return err
	}
	_, err = os.Stdout.Write(files.RunHelper(payload))
	return err
}
