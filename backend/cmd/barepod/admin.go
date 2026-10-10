package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/farrasrayhand/barepod-panel/backend/internal/auth"
	"github.com/farrasrayhand/barepod-panel/backend/internal/config"
	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
	"github.com/farrasrayhand/barepod-panel/backend/internal/rbac"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

func runAdmin(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: barepod admin <create|passwd> [flags]")
	}
	switch args[0] {
	case "create":
		return adminCreate(args[1:])
	case "passwd", "password":
		return adminPasswd(args[1:])
	default:
		return fmt.Errorf("unknown admin command %q (expected create or passwd)", args[0])
	}
}

func runUser(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: barepod user <create|list|suspend|activate> [username]")
	}
	switch args[0] {
	case "list":
		return userList(args[1:])
	case "create":
		return userCreate(args[1:])
	case "suspend":
		return userSetStatus(args[1:], "suspended")
	case "activate":
		return userSetStatus(args[1:], "active")
	default:
		return fmt.Errorf("unknown user command %q", args[0])
	}
}

// userCreate adds a normal (non-admin) account to a permission group.
func userCreate(args []string) error {
	fs := flag.NewFlagSet("barepod user create", flag.ContinueOnError)
	username := fs.String("username", "", "account name")
	email := fs.String("email", "", "email address (defaults to <username>@barepod.local)")
	group := fs.String("group", "Developer", "permission group the account joins")
	password := fs.String("password", "", "password (defaults to a generated one; BAREPOD_ADMIN_PASSWORD)")
	dbPath := fs.String("db", config.DefaultDBPath(), "path to the panel database")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *username == "" && len(fs.Args()) == 1 {
		*username = fs.Args()[0]
	}
	if *username == "" {
		return errors.New("usage: barepod user create --username <name> [--group Developer] [--password <pw>]")
	}

	st, err := openStoreForCLI(*dbPath)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()

	grp, err := st.GroupByName(*group)
	if err != nil {
		return fmt.Errorf("group %q does not exist — available groups: %s", *group, strings.Join(groupNames(st), ", "))
	}

	pw, generated := resolvePassword(*password)
	hash, err := auth.HashPassword(pw)
	if err != nil {
		return err
	}
	mail := *email
	if mail == "" {
		mail = *username + "@barepod.local"
	}

	user, err := st.CreateUser(*username, mail, hash, "user", grp.Name)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return fmt.Errorf("account %q already exists", *username)
		}
		return err
	}
	if err := st.Audit(user.ID, "cli.user_create", *username, "cli", "group="+grp.Name); err != nil {
		return err
	}

	fmt.Printf("Account %q created in group %q.\n\n", *username, grp.Name)
	printCredentials(*username, pw, generated, *dbPath)
	return nil
}

func groupNames(st *store.Store) []string {
	groups, err := st.ListGroups()
	if err != nil {
		return nil
	}
	names := make([]string, 0, len(groups))
	for _, g := range groups {
		names = append(names, g.Name)
	}
	return names
}

func openStoreForCLI(dbPath string) (*store.Store, error) {
	st, err := store.Open(dbPath)
	if err != nil {
		return nil, fmt.Errorf("open database %s: %w (run this as root, or pass -db)", dbPath, err)
	}
	// The built-in groups must exist before any account joins one.
	if _, err := st.EnsureDefaultGroups(); err != nil {
		_ = st.Close()
		return nil, err
	}
	return st, nil
}

// resolvePassword prefers the flag, then the environment, then generates one.
// The bool reports whether the value was generated (so it can be printed once).
func resolvePassword(flagValue string) (string, bool) {
	if flagValue != "" {
		return flagValue, false
	}
	if fromEnv := os.Getenv("BAREPOD_ADMIN_PASSWORD"); fromEnv != "" {
		return fromEnv, false
	}
	return id.Token(12), true
}

func printCredentials(username, password string, generated bool, dbPath string) {
	fmt.Println("Panel sign-in")
	fmt.Printf("  username  %s\n", username)
	if generated {
		fmt.Printf("  password  %s   (generated — shown once)\n", password)
	} else {
		fmt.Printf("  password  %s   (as supplied)\n", password)
	}
	fmt.Printf("\nDatabase      %s\n", dbPath)
	fmt.Println("Change the password from Profile → Change Password after signing in.")
}

func adminCreate(args []string) error {
	fs := flag.NewFlagSet("barepod admin create", flag.ContinueOnError)
	username := fs.String("username", "admin", "username of the root admin")
	email := fs.String("email", "", "email address (defaults to <username>@barepod.local)")
	password := fs.String("password", "", "password (defaults to a generated one; BAREPOD_ADMIN_PASSWORD)")
	dbPath := fs.String("db", config.DefaultDBPath(), "path to the panel database")
	force := fs.Bool("force", false, "reset the password if the account already exists")
	if err := fs.Parse(args); err != nil {
		return err
	}

	st, err := openStoreForCLI(*dbPath)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()

	existing, err := st.UserByUsername(*username)
	switch {
	case err == nil:
		if !*force {
			return fmt.Errorf("account %q already exists — use --force to reset its password", *username)
		}
	case errors.Is(err, store.ErrNotFound):
		existing = nil
	default:
		return err
	}

	pw, generated := resolvePassword(*password)
	hash, err := auth.HashPassword(pw)
	if err != nil {
		return err
	}

	if existing == nil {
		mail := *email
		if mail == "" {
			mail = *username + "@barepod.local"
		}
		created, err := st.CreateUser(*username, mail, hash, "admin", rbac.RootGroup)
		if err != nil {
			return err
		}
		if err := st.Audit(created.ID, "cli.admin_create", created.Username, "cli", ""); err != nil {
			return err
		}
		fmt.Printf("Root admin %q created.\n\n", created.Username)
	} else {
		if _, err := st.SetUserPassword(*username, hash); err != nil {
			return err
		}
		if err := st.SetUserRole(*username, "admin", rbac.RootGroup); err != nil {
			return err
		}
		if err := st.Audit(existing.ID, "cli.admin_password_reset", *username, "cli", ""); err != nil {
			return err
		}
		fmt.Printf("Password reset for root admin %q (its sessions were revoked).\n\n", *username)
	}

	printCredentials(*username, pw, generated, *dbPath)
	return nil
}

func adminPasswd(args []string) error {
	fs := flag.NewFlagSet("barepod admin passwd", flag.ContinueOnError)
	password := fs.String("password", "", "password (defaults to a generated one; BAREPOD_ADMIN_PASSWORD)")
	dbPath := fs.String("db", config.DefaultDBPath(), "path to the panel database")
	if err := fs.Parse(args); err != nil {
		return err
	}
	rest := fs.Args()
	if len(rest) != 1 {
		return errors.New("usage: barepod admin passwd [--password <pw>] <username>")
	}
	username := rest[0]

	st, err := openStoreForCLI(*dbPath)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()

	pw, generated := resolvePassword(*password)
	hash, err := auth.HashPassword(pw)
	if err != nil {
		return err
	}
	updated, err := st.SetUserPassword(username, hash)
	if errors.Is(err, store.ErrNotFound) {
		return fmt.Errorf("account %q does not exist", username)
	}
	if err != nil {
		return err
	}
	if err := st.Audit(updated.ID, "cli.password_reset", username, "cli", ""); err != nil {
		return err
	}
	fmt.Printf("Password updated for %q (its sessions were revoked).\n\n", username)
	printCredentials(username, pw, generated, *dbPath)
	return nil
}

func userList(args []string) error {
	fs := flag.NewFlagSet("barepod user list", flag.ContinueOnError)
	dbPath := fs.String("db", config.DefaultDBPath(), "path to the panel database")
	if err := fs.Parse(args); err != nil {
		return err
	}

	st, err := openStoreForCLI(*dbPath)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()

	users, err := st.ListUsers()
	if err != nil {
		return err
	}
	if len(users) == 0 {
		fmt.Println("No panel accounts yet — create one with: barepod admin create")
		return nil
	}

	tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(tw, "USERNAME\tROLE\tGROUP\tSTATUS\tCREATED")
	for _, u := range users {
		fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\n", u.Username, u.Role, u.GroupName, u.Status, u.CreatedAt)
	}
	return tw.Flush()
}

func userSetStatus(args []string, status string) error {
	fs := flag.NewFlagSet("barepod user status", flag.ContinueOnError)
	dbPath := fs.String("db", config.DefaultDBPath(), "path to the panel database")
	if err := fs.Parse(args); err != nil {
		return err
	}
	rest := fs.Args()
	if len(rest) != 1 {
		return errors.New("usage: barepod user <suspend|activate> [--db <path>] <username>")
	}
	username := rest[0]

	st, err := openStoreForCLI(*dbPath)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()

	if _, err := st.UserByUsername(username); err != nil {
		return fmt.Errorf("account %q does not exist", username)
	}
	if err := st.SetUserStatus(username, status); err != nil {
		return err
	}
	if status == "active" {
		fmt.Printf("Account %q is active again.\n", username)
	} else {
		fmt.Printf("Account %q suspended — its sessions were revoked and it cannot sign in.\n", username)
	}
	return nil
}
