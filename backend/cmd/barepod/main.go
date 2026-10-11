// Command barepod is the BarePod Panel CLI and daemon.
//
//	barepod admin create     create the root admin account (run this after install)
//	barepod admin passwd     reset a panel password
//	barepod user list        list panel accounts
//	barepod serve            run the daemon
//
// The same binary performs privileged work, so it is the single entrypoint in
// the install script.
package main

import (
	"errors"
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/farrasrayhand/barepod-panel/backend/internal/api"
)

// version comes from the api package: one source of truth for the panel version.
var version = api.Version

func usage() {
	fmt.Fprint(os.Stderr, `BarePod Panel — self-hosted control panel

Usage:
  barepod <command> [flags]

Commands:
  serve                 run the daemon (API + SPA)
  admin create          create the root admin account
  admin passwd <user>   set a new password for an account
  user create           create a non-admin account in a group
  user list             list panel accounts
  user suspend <user>   suspend an account (revokes its sessions, locks the Linux user)
  user activate <user>  re-activate a suspended account
  group list            show packages with their permissions and resource limits
  tenant provision      create/repair the Linux account for a panel user
  version               print the version
  help                  print this help

Run "barepod <command> -h" for the flags of a command.
`)
}

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	var err error
	switch os.Args[1] {
	case "serve", "daemon":
		err = runServe(os.Args[2:])
	case "admin":
		err = runAdmin(os.Args[2:])
	case "user":
		err = runUser(os.Args[2:])
	case "group":
		err = runGroup(os.Args[2:])
	case "tenant":
		err = runTenant(os.Args[2:])
	case "fs-exec":
		// Hidden helper: one file operation, run as the tenant (see internal/files).
		err = runFSExec()
	case "version", "-v", "--version":
		fmt.Println("barepod " + version)
	case "help", "-h", "--help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n", os.Args[1])
		usage()
		os.Exit(2)
	}

	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		fmt.Fprintln(os.Stderr, "barepod: "+err.Error())
		os.Exit(1)
	}
}
