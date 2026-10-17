package main

import (
	"fmt"
	"os"
	"os/exec"

	"github.com/farrasrayhand/barepod-panel/backend/internal/stack"
)

// runStack handles `barepod stack <subcommand>`: host-level preparation the install
// script performs before the daemon starts, using the same allowlisted steps the panel runs.
//
//	barepod stack repos    add the package repositories (PHP, Python, databases, web servers)
func runStack(args []string) error {
	if len(args) == 0 || args[0] != "repos" {
		return fmt.Errorf("usage: barepod stack repos")
	}
	steps, err := stack.Commands("repositories", "")
	if err != nil {
		return err
	}
	failed := 0
	for i, argv := range steps {
		fmt.Printf("[barepod] repositories %d/%d\n", i+1, len(steps))
		cmd := exec.Command(argv[0], argv[1:]...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		// One unreachable mirror must not stop the others: the panel shows what is missing.
		if err := cmd.Run(); err != nil {
			failed++
			fmt.Fprintf(os.Stderr, "[barepod] step %d reported a problem: %v\n", i+1, err)
		}
	}
	if failed > 0 {
		return fmt.Errorf("%d of %d repository steps reported a problem", failed, len(steps))
	}
	return nil
}
