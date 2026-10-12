package store

import (
	"testing"
	"time"
)

// An unconfigured panel must still be protected, so the defaults are what a fresh database
// answers — no screen has to be visited for the lockout to work.
func TestGuardSettingsFallBackToDefaults(t *testing.T) {
	st := newTestStore(t)
	settings, err := st.GuardSettings()
	if err != nil {
		t.Fatalf("read defaults: %v", err)
	}
	want := DefaultGuardSettings()
	if !settings.Enabled || settings.MaxRetry != want.MaxRetry ||
		settings.FindTime != want.FindTime || settings.BanTime != want.BanTime {
		t.Fatalf("unexpected defaults: %+v", settings)
	}
}

func TestGuardSettingsAndBansSurviveARestart(t *testing.T) {
	st := newTestStore(t)
	if err := st.SaveGuardSettings(GuardSettings{
		Enabled: true, MaxRetry: 7, FindTime: 3 * time.Minute, BanTime: 4 * time.Hour,
	}); err != nil {
		t.Fatalf("save settings: %v", err)
	}
	settings, err := st.GuardSettings()
	if err != nil {
		t.Fatalf("read settings: %v", err)
	}
	if settings.MaxRetry != 7 || settings.FindTime != 3*time.Minute || settings.BanTime != 4*time.Hour {
		t.Fatalf("the settings were not kept: %+v", settings)
	}
	if settings.UpdatedAt == "" {
		t.Error("the change was not stamped")
	}

	now := time.Now().UTC().Truncate(time.Second)
	if err := st.SaveGuardBan(GuardBan{
		IP: "203.0.113.7", Engine: "postgresql", User: "evil", Reason: "5 refused logins",
		Hits: 5, BannedAt: now, ExpiresAt: now.Add(time.Hour),
	}); err != nil {
		t.Fatalf("save ban: %v", err)
	}
	// Saving the same address again refreshes it rather than duplicating it: one row per
	// address is what makes the kernel set and the panel agree. A save writes the whole row,
	// so the detail travels with it.
	if err := st.SaveGuardBan(GuardBan{
		IP: "203.0.113.7", Engine: "postgresql", User: "evil", Reason: "9 refused logins",
		Hits: 9, BannedAt: now, ExpiresAt: now.Add(2 * time.Hour),
	}); err != nil {
		t.Fatalf("refresh ban: %v", err)
	}
	bans, err := st.GuardBans()
	if err != nil {
		t.Fatalf("list bans: %v", err)
	}
	if len(bans) != 1 {
		t.Fatalf("want one ban, got %d: %+v", len(bans), bans)
	}
	if bans[0].Hits != 9 || bans[0].Engine != "postgresql" || bans[0].User != "evil" {
		t.Errorf("the ban lost its detail: %+v", bans[0])
	}
	if !bans[0].ExpiresAt.Equal(now.Add(2 * time.Hour)) {
		t.Errorf("the refresh did not extend the ban: %+v", bans[0].ExpiresAt)
	}

	// An expired ban is released, a live one is kept.
	if err := st.SaveGuardBan(GuardBan{
		IP: "198.51.100.9", BannedAt: now.Add(-2 * time.Hour), ExpiresAt: now.Add(-time.Hour),
	}); err != nil {
		t.Fatalf("save expired ban: %v", err)
	}
	released, err := st.DropExpiredGuardBans(now)
	if err != nil {
		t.Fatalf("drop expired: %v", err)
	}
	if released != 1 {
		t.Errorf("want one released, got %d", released)
	}
	remaining, err := st.GuardBans()
	if err != nil {
		t.Fatalf("list after expiry: %v", err)
	}
	if len(remaining) != 1 || remaining[0].IP != "203.0.113.7" {
		t.Errorf("the wrong ban survived: %+v", remaining)
	}

	if err := st.DropGuardBan("203.0.113.7"); err != nil {
		t.Fatalf("drop ban: %v", err)
	}
	remaining, err = st.GuardBans()
	if err != nil {
		t.Fatalf("list after release: %v", err)
	}
	if len(remaining) != 0 {
		t.Errorf("the released ban is still listed: %+v", remaining)
	}
}
