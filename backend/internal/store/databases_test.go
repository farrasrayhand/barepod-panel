package store

import "testing"

// The record-repair helpers are easy to get wrong in SQL alone: a wrong column name
// compiles, passes every other test, and only fails when a live record is touched —
// writing to `user` instead of `db_user` answered 500 the first time it ran. This drives
// each of them against a real database, including the counts the quota guard reads.
func TestDatabaseRecordRepairsWriteTheColumnsTheyName(t *testing.T) {
	st := newTestStore(t)
	record := &Database{
		Kind: KindDatabase, Engine: "postgresql", Alias: "reports",
		Name: "admin_reports_db", TenantUser: "admin", Status: "pending",
	}
	if err := st.CreateDatabase(record); err != nil {
		t.Fatal(err)
	}

	if err := st.SetDatabaseUser(record.ID, "admin_reports_db"); err != nil {
		t.Fatalf("SetDatabaseUser: %v", err)
	}
	if err := st.SetDatabaseAddress(record.ID, "127.0.0.1", 5432); err != nil {
		t.Fatalf("SetDatabaseAddress: %v", err)
	}
	if err := st.SetDatabaseStatus(record.ID, "ready", ""); err != nil {
		t.Fatalf("SetDatabaseStatus: %v", err)
	}

	got, err := st.DatabaseByID(record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.User != "admin_reports_db" {
		t.Errorf("the account name was not written: %q", got.User)
	}
	if got.Host != "127.0.0.1" || got.Port != 5432 {
		t.Errorf("the address was not written: %s:%d", got.Host, got.Port)
	}
	if got.Status != "ready" || got.Note != "" {
		t.Errorf("the status was not written: %q %q", got.Status, got.Note)
	}

	if n, err := st.CountDatabasesByTenant("admin"); err != nil || n != 1 {
		t.Errorf("CountDatabasesByTenant = %d, %v (want 1)", n, err)
	}
	if err := st.BinDatabase(record.ID); err != nil {
		t.Fatal(err)
	}
	if n, err := st.CountDatabasesByTenant("admin"); err != nil || n != 0 {
		t.Errorf("a binned record must not count towards the allowance: %d, %v", n, err)
	}
	if all, err := st.AllDatabases(); err != nil || len(all) != 1 {
		t.Errorf("AllDatabases = %d records, %v (want 1: the sweep sees binned records too)", len(all), err)
	}
}
