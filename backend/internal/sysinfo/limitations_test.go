package sysinfo

import (
	"runtime"
	"testing"
)

func TestLimitationsOnAnUnprivilegedContainer(t *testing.T) {
	// What a typical unprivileged LXC container reports.
	caps := Capabilities{
		OS: "linux", LXC: true,
		Systemd: true, Smart: false, Fstrim: false, Useradd: true, Quota: false, RunAsUser: true,
	}

	limitations := caps.Limitations()
	features := map[string]Limitation{}
	for _, l := range limitations {
		features[l.Feature] = l
	}

	for _, want := range []string{"smart", "fstrim", "quota"} {
		entry, ok := features[want]
		if !ok {
			t.Errorf("no limitation reported for %q", want)
			continue
		}
		if entry.Reason == "" || entry.Advice == "" {
			t.Errorf("%q needs both a reason and advice: %+v", want, entry)
		}
	}
	if _, ok := features["useradd"]; ok {
		t.Error("useradd was reported as unavailable although it is present")
	}
}

func TestLimitationsOnAMacDevelopmentHost(t *testing.T) {
	caps := Capabilities{OS: runtime.GOOS, RunAsUser: runtime.GOOS == "linux"}
	limitations := caps.Limitations()
	if len(limitations) == 0 {
		t.Fatal("a host without tenant support must explain itself")
	}
	for _, l := range limitations {
		if l.Reason == "" || l.Advice == "" {
			t.Errorf("limitation %q is missing text: %+v", l.Feature, l)
		}
	}
}

func TestLimitationsIsEmptyOnAFullHost(t *testing.T) {
	caps := Capabilities{
		OS: "linux", Systemd: true, Smart: true, Fstrim: true,
		Useradd: true, Quota: true, RunAsUser: true, DiskStats: true, PTYJail: true,
	}
	if got := caps.Limitations(); len(got) != 0 {
		t.Fatalf("a fully capable host reported limitations: %+v", got)
	}
}

func TestLimitationsMentionTheTerminalJail(t *testing.T) {
	// Without mount namespaces a site shell cannot be confined, and the panel has
	// to say so rather than let an operator assume it is.
	caps := Capabilities{OS: "linux", RunAsUser: true}
	found := false
	for _, l := range caps.Limitations() {
		if l.Feature == "ptyJail" {
			found = true
			if l.Reason == "" || l.Advice == "" {
				t.Errorf("the ptyJail limitation is missing text: %+v", l)
			}
		}
	}
	if !found {
		t.Error("a host without mount namespaces must explain the unconfined terminal")
	}
}

func TestLimitationFeaturesAreUnique(t *testing.T) {
	caps := Capabilities{OS: "linux"}
	seen := map[string]bool{}
	for _, l := range caps.Limitations() {
		if seen[l.Feature] {
			t.Errorf("feature %q reported twice", l.Feature)
		}
		seen[l.Feature] = true
	}
}
