package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"

	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/stack"
)

// runStack handles `barepod stack <subcommand>`: host-level preparation the install
// script performs before the daemon starts, using the same allowlisted steps the panel runs.
//
//	barepod stack repos     add the package repositories (PHP, Python, databases, web servers)
//	barepod stack autoheal  run automatic health checks, repairs, and maintenance page sync
func runStack(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: barepod stack <repos|autoheal>")
	}
	switch args[0] {
	case "autoheal", "repair":
		runner := host.Runner(host.RealRunner{})
		actions := stack.AutoHeal(context.Background(), runner, "")
		for _, act := range actions {
			fmt.Printf("[barepod autoheal] %s\n", act)
		}
		if len(actions) == 0 {
			fmt.Println("[barepod autoheal] All stack components and web servers are healthy.")
		}
		return nil
	case "repos":
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
	default:
		return fmt.Errorf("unknown stack command %q (supported: repos, autoheal)", args[0])
	}
}
