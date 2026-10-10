// Package rbac defines the panel capability set and the built-in groups.
//
// The only rows the panel ever creates on its own are these groups: the panel
// installs empty (no users, no websites) and the operator creates their own
// account with `barepod admin create`.
package rbac

// Capability names — these must match the frontend GroupPermissions type
// (frontend/src/data/permissions.ts).
const (
	CapDeployApps        = "deployApps"
	CapFileManager       = "fileManager"
	CapTerminal          = "terminal"
	CapDatabases         = "databases"
	CapBackups           = "backups"
	CapDomains           = "domains"
	CapCloudflareTunnels = "cloudflareTunnels"
	CapMonitoring        = "monitoring"
	CapUsers             = "users"
	CapAPITokens         = "apiTokens"
)

// All lists every capability, in the order the UI shows them.
var All = []string{
	CapDeployApps,
	CapFileManager,
	CapTerminal,
	CapDatabases,
	CapBackups,
	CapDomains,
	CapCloudflareTunnels,
	CapMonitoring,
	CapUsers,
	CapAPITokens,
}

// Permissions is a capability set.
type Permissions map[string]bool

// Allows reports whether a capability is granted.
func (p Permissions) Allows(capability string) bool { return p[capability] }

// Normalised returns the set with every known capability present.
func (p Permissions) Normalised() Permissions {
	out := make(Permissions, len(All))
	for _, c := range All {
		out[c] = p[c]
	}
	return out
}

// GrantAll grants every capability (root admin).
func GrantAll() Permissions {
	out := make(Permissions, len(All))
	for _, c := range All {
		out[c] = true
	}
	return out
}

// GrantNothing grants no capability (view-only).
func GrantNothing() Permissions { return Permissions{} }

// Group is a permission group.
type Group struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Permissions Permissions `json:"permissions"`
	Members     int         `json:"members,omitempty"`
	IsDefault   bool        `json:"isDefault"`
	IsSystem    bool        `json:"isSystem"`
	CreatedAt   string      `json:"createdAt,omitempty"`
}

// RootGroup is the group every account created by `barepod admin create` joins.
const RootGroup = "Superadmin (Root)"

// DefaultGroups are seeded once on a fresh database — and that is the only
// built-in data the panel has.
func DefaultGroups() []Group {
	return []Group{
		{
			Name:        RootGroup,
			Description: "Full access to every module.",
			Permissions: GrantAll(),
			IsDefault:   true,
			IsSystem:    true,
		},
		{
			Name:        "Developer",
			Description: "Deploy and operate websites; no user or token administration.",
			Permissions: Permissions{
				CapDeployApps:        true,
				CapFileManager:       true,
				CapTerminal:          true,
				CapDatabases:         true,
				CapBackups:           true,
				CapDomains:           true,
				CapCloudflareTunnels: true,
				CapMonitoring:        true,
				CapUsers:             false,
				CapAPITokens:         false,
			},
			IsDefault: true,
			IsSystem:  true,
		},
		{
			Name:        "Read Only",
			Description: "View dashboards, metrics and logs; nothing can be changed.",
			Permissions: GrantNothing(),
			IsDefault:   true,
			IsSystem:    true,
		},
	}
}
