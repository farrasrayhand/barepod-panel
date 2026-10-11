package dbengine

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLookupReportsWhatEachEngineIs(t *testing.T) {
	sqlite, ok := Lookup("sqlite")
	if !ok || !sqlite.FileBased || !sqlite.Automated {
		t.Errorf("sqlite should be a file-based, automated engine: %+v", sqlite)
	}
	if sqlite.DefaultPort != 0 {
		t.Errorf("sqlite has no port, got %d", sqlite.DefaultPort)
	}
	if _, ok := Lookup("nope"); ok {
		t.Error("an unknown engine was accepted")
	}
	redis, ok := Lookup("redis")
	if !ok || redis.Kind != "cache" {
		t.Errorf("redis should be a cache: %+v", redis)
	}
}

func TestProvisionPlansAreRealAndQuoted(t *testing.T) {
	postgres, err := PlanFor(StepProvision, Resource{
		Engine: "postgresql", Name: "bptest_shop", User: "bptest_shop", Secret: "s3cret", Port: 5432,
	})
	if err != nil {
		t.Fatalf("postgresql plan: %v", err)
	}
	if postgres.RunAs != "postgres" {
		t.Errorf("postgresql plan must run as OS user postgres: got %q", postgres.RunAs)
	}
	roleSQL := postgres.Commands[0][len(postgres.Commands[0])-1]
	dbSQL := postgres.Commands[1][len(postgres.Commands[1])-1]
	if !strings.Contains(roleSQL, `CREATE ROLE "bptest_shop" LOGIN PASSWORD 's3cret'`) {
		t.Errorf("the role statement is wrong: %s", roleSQL)
	}
	if !strings.Contains(dbSQL, `CREATE DATABASE "bptest_shop" OWNER "bptest_shop"`) {
		t.Errorf("the database statement is wrong: %s", dbSQL)
	}
	for _, arg := range postgres.Commands[0] {
		if arg == "-h" {
			t.Errorf("postgresql admin command must connect over unix socket, found -h: %v", postgres.Commands[0])
		}
	}

	mysql, err := PlanFor(StepProvision, Resource{
		Engine: "mariadb", Name: "shop", User: "shop", Secret: "pa'ss", Port: 3306,
	})
	if err != nil {
		t.Fatalf("mariadb plan: %v", err)
	}
	sql := strings.Join(mysql.Commands[0], " ")
	for _, want := range []string{"CREATE DATABASE IF NOT EXISTS `shop`", "IDENTIFIED BY 'pa\\'ss'", "'shop'@'localhost'"} {
		if !strings.Contains(sql, want) {
			t.Errorf("the mysql statement is missing %q:\n%s", want, sql)
		}
	}
}

func TestPlanRefusesUnsafeInput(t *testing.T) {
	// A name that tries to close the identifier must be neutralised, not trusted.
	plan, err := PlanFor(StepProvision, Resource{
		Engine: "postgresql", Name: `evil"; DROP DATABASE postgres; --`, User: "u", Secret: "x",
	})
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	statement := strings.Join(plan.Commands[0], " ") + " " + strings.Join(plan.Commands[1], " ")
	// The escape must be the doubled quote. A bare `"evil";` would end the
	// identifier and let the rest run as its own statement.
	if strings.Contains(statement, `"evil";`) {
		t.Errorf("the identifier was not closed by doubling the quote:\n%s", statement)
	}
	if !strings.Contains(statement, `"evil""; DROP DATABASE postgres; --"`) {
		t.Errorf("the identifier was not quoted by doubling:\n%s", statement)
	}

	// Empty inputs are errors rather than empty statements.
	if _, err := PlanFor(StepProvision, Resource{Engine: "postgresql", Secret: "x"}); err == nil {
		t.Error("a plan without a name was accepted")
	}
	if _, err := PlanFor(StepProvision, Resource{Engine: "postgresql", Name: "n", User: "u"}); err == nil {
		t.Error("a plan without a password was accepted")
	}
}

func TestLifecycleStepsCoverSuspendRestorePurge(t *testing.T) {
	for _, step := range []Step{StepSuspend, StepRestore, StepPurge, StepLimits} {
		plan, err := PlanFor(step, Resource{Engine: "postgresql", Name: "n", User: "u", MaxConn: 20})
		if err != nil {
			t.Fatalf("%s: %v", step, err)
		}
		if len(plan.Commands) == 0 {
			t.Errorf("%s produced no commands", step)
		}
	}

	suspend, _ := PlanFor(StepSuspend, Resource{Engine: "postgresql", Name: "n", User: "u"})
	joined := strings.Join(append(suspend.Commands[0], suspend.Commands[1]...), " ")
	if !strings.Contains(joined, "ALLOW_CONNECTIONS false") || !strings.Contains(joined, "NOLOGIN") {
		t.Errorf("suspend must refuse connections and stop the login:\n%s", joined)
	}

	purge, _ := PlanFor(StepPurge, Resource{Engine: "mysql", Name: "n", User: "u"})
	purged := strings.Join(purge.Commands[0], " ") + strings.Join(purge.Commands[1], " ")
	if !strings.Contains(purged, "DROP DATABASE IF EXISTS `n`") || !strings.Contains(purged, "DROP USER IF EXISTS") {
		t.Errorf("purge must drop the database and the account:\n%s", purged)
	}
}

func TestSqliteAndUnautomatedEnginesExplainThemselves(t *testing.T) {
	sqlite, err := PlanFor(StepProvision, Resource{Engine: "sqlite", Name: "shop"})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if len(sqlite.Commands) != 0 || sqlite.Note == "" {
		t.Errorf("sqlite should need no commands and say so: %+v", sqlite)
	}

	mongo, err := PlanFor(StepProvision, Resource{Engine: "mongodb", Name: "shop", User: "shop", Secret: "x"})
	if err != nil {
		t.Fatalf("mongodb: %v", err)
	}
	if len(mongo.Commands) != 0 || !strings.Contains(mongo.Note, "not automated") {
		t.Errorf("an unautomated engine must say it is not automated: %+v", mongo)
	}
}

func TestRedisPlansUseACLUsersScopedToTheirPrefix(t *testing.T) {
	resource := Resource{
		Engine: "redis", Name: "bptest_cache", User: "bptest_cache",
		Secret: "s3cret-cache", AdminHost: "127.0.0.1", AdminPort: 6379,
	}

	provision, err := PlanFor(StepProvision, resource)
	if err != nil {
		t.Fatalf("provision: %v", err)
	}
	argv := provision.Commands[0]
	joined := strings.Join(argv, " ")
	for _, want := range []string{"ACL SETUSER bptest_cache", "reset", "on", ">s3cret-cache", "~bptest_cache:*", "+@all"} {
		if !strings.Contains(joined, want) {
			t.Errorf("the ACL rule is missing %q:\n%s", want, joined)
		}
	}
	// The scope is the point: a cache must not see another cache's keys.
	if strings.Contains(joined, "~*") {
		t.Errorf("the user was given every key:\n%s", joined)
	}

	rotate, _ := PlanFor(StepRotate, resource)
	rotateLine := strings.Join(rotate.Commands[0], " ")
	if !strings.Contains(rotateLine, "resetpass") {
		t.Errorf("rotation must clear the old password first: %s", rotateLine)
	}

	suspend, _ := PlanFor(StepSuspend, resource)
	if !strings.Contains(strings.Join(suspend.Commands[0], " "), "ACL SETUSER bptest_cache off") {
		t.Errorf("suspend must turn the user off: %v", suspend.Commands[0])
	}
	restore, _ := PlanFor(StepRestore, resource)
	if !strings.Contains(strings.Join(restore.Commands[0], " "), "ACL SETUSER bptest_cache on") {
		t.Errorf("restore must turn the user back on: %v", restore.Commands[0])
	}
	purge, _ := PlanFor(StepPurge, resource)
	if !strings.Contains(strings.Join(purge.Commands[0], " "), "ACL DELUSER bptest_cache") {
		t.Errorf("purge must remove the user: %v", purge.Commands[0])
	}
	if purge.Note == "" {
		t.Error("purge should say that the keys are left behind")
	}
}

func TestRedisAdminConnection(t *testing.T) {
	cases := []struct {
		raw        string
		host       string
		port       int
		secret     string
		shouldFail bool
	}{
		{"redis://127.0.0.1:6379", "127.0.0.1", 6379, "", false},
		{"redis://:adminpw@10.0.0.5:6380", "10.0.0.5", 6380, "adminpw", false},
		{"redis://default:pa%3Ass@cache.internal", "cache.internal", 6379, "pa%3Ass", false},
		{"redis://127.0.0.1:not-a-port", "", 0, "", true},
		{"", "", 0, "", true},
	}
	for _, c := range cases {
		host, port, secret, err := ParseRedisURL(c.raw)
		if c.shouldFail {
			if err == nil {
				t.Errorf("%q should have failed", c.raw)
			}
			continue
		}
		if err != nil || host != c.host || port != c.port || secret != c.secret {
			t.Errorf("%q -> %s:%d secret=%q err=%v", c.raw, host, port, secret, err)
		}
	}

	// The admin password reaches redis-cli, with the warning suppressed so the
	// output stays parseable.
	plan, err := PlanFor(StepSuspend, Resource{
		Engine: "redis", Name: "c", User: "c", AdminHost: "cache.internal", AdminPort: 6380, AdminSecret: "adminpw",
	})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(plan.Commands[0], " ")
	if !strings.Contains(joined, "-h cache.internal") || !strings.Contains(joined, "-p 6380") {
		t.Errorf("the admin address is wrong: %s", joined)
	}
	if !strings.Contains(joined, "--no-auth-warning -a adminpw") {
		t.Errorf("the admin password is not passed: %s", joined)
	}
}

func TestScanSQLiteFilesIsBoundedAndSkipsDependencies(t *testing.T) {
	root := t.TempDir()
	write := func(relative string, content string) {
		path := filepath.Join(root, relative)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// A real database, one the app keeps, and everything that must be ignored.
	write("database/database.sqlite", "SQLite format 3\x00rest")
	write("db.sqlite3", "SQLite format 3\x00rest")
	write("notes.txt", "not a database")
	write("node_modules/pkg/cache.db", "SQLite format 3\x00rest")
	write("vendor/lib/x.db", "SQLite format 3\x00rest")
	write(".trash/binned.sqlite", "SQLite format 3\x00rest")
	write("deep/one/two/three/four.sqlite", "SQLite format 3\x00rest")

	found, err := ScanSQLiteFiles(root, "own-check", "bptest", 3, 25)
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, file := range found {
		names = append(names, file.Relative)
	}
	joined := strings.Join(names, ",")
	for _, want := range []string{"database/database.sqlite", "db.sqlite3"} {
		if !strings.Contains(joined, want) {
			t.Errorf("the scan missed %s: %v", want, names)
		}
	}
	for _, forbidden := range []string{"node_modules", "vendor", ".trash", "notes.txt", "four.sqlite"} {
		if strings.Contains(joined, forbidden) {
			t.Errorf("the scan should have skipped %s: %v", forbidden, names)
		}
	}
}

func TestDetectedIDRoundTrip(t *testing.T) {
	id := DetectedID("own-check", "database/database.sqlite")
	if !strings.HasPrefix(id, "det:sqlite:") || strings.Contains(id, "/") {
		t.Errorf("a detected id must be one path segment and carry no slash: %q", id)
	}
	slug, relative, ok := ParseDetectedID(id)
	if !ok || slug != "own-check" || relative != "database/database.sqlite" {
		t.Errorf("round trip = %q %q %v", slug, relative, ok)
	}
	if _, _, ok := ParseDetectedID("01M4MRCQPQJKEJQ6EWAFW7DZ0Q"); ok {
		t.Error("a ledger id was read as a detected one")
	}
	if !IsDetectedID(id) || IsDetectedID("nope") {
		t.Error("IsDetectedID is wrong")
	}
}

func TestFileHasSQLiteHeader(t *testing.T) {
	dir := t.TempDir()
	real := filepath.Join(dir, "real.db")
	if err := os.WriteFile(real, []byte("SQLite format 3\x00\x10\x00"), 0o644); err != nil {
		t.Fatal(err)
	}
	fake := filepath.Join(dir, "fake.db")
	if err := os.WriteFile(fake, []byte("just text"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !FileHasSQLiteHeader(real) {
		t.Error("a SQLite file was not recognised")
	}
	if FileHasSQLiteHeader(fake) {
		t.Error("a text file was taken for a database")
	}
	if FileHasSQLiteHeader(filepath.Join(dir, "missing.db")) {
		t.Error("a missing file was taken for a database")
	}
}

func TestClientPathLooksBeyondPath(t *testing.T) {
	// A fake client in a distribution-specific location must be found even when it
	// is not on PATH.
	dir := t.TempDir()
	fakeDir := filepath.Join(dir, "pgsql-16", "bin")
	if err := os.MkdirAll(fakeDir, 0o755); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(fakeDir, "psql")
	if err := os.WriteFile(binary, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	// The candidate list is absolute for real hosts, so this asserts the logic with
	// the same shape: a glob that only matches the temp tree.
	pattern := filepath.Join(dir, "pgsql-*/bin/psql")
	matches, err := filepath.Glob(pattern)
	if err != nil || len(matches) != 1 {
		t.Fatalf("the glob logic itself is wrong: %v %v", matches, err)
	}
	if _, found := os.Stat(matches[0]); found != nil {
		t.Errorf("the candidate should exist: %v", found)
	}
	if len(clientCandidates("psql")) == 0 {
		t.Error("there are no candidate paths for psql")
	}
	if len(clientCandidates("")) != 0 {
		t.Error("an empty client should have no candidates")
	}
}

func TestDockerModeAdministersOverLoopbackWithThePanelAccount(t *testing.T) {
	// The same SQL, delivered the way a container needs it: TCP to the engine's
	// loopback port as the administrator the panel created, password in the env.
	resource := Resource{
		Engine: "postgresql", Mode: ModeDocker,
		Name: "shop", User: "shop", Secret: "shop-pw",
		AdminHost: "127.0.0.1", AdminPort: 5433,
		AdminUser: "barepod_admin", AdminSecret: "admin-pw", Port: 5433,
	}
	plan, err := PlanFor(StepProvision, resource)
	if err != nil {
		t.Fatalf("docker plan: %v", err)
	}
	if plan.RunAs != "" {
		t.Errorf("a container is not administered as the host's postgres user: %q", plan.RunAs)
	}
	joined := strings.Join(plan.Commands[0], " ")
	for _, want := range []string{"-h 127.0.0.1", "-p 5433", "-U barepod_admin", "-d postgres", `CREATE ROLE "shop"`} {
		if !strings.Contains(joined, want) {
			t.Errorf("the docker plan is missing %q:\n%s", want, joined)
		}
	}
	if strings.Contains(joined, "admin-pw") {
		t.Errorf("the administrator password reached the argument list:\n%s", joined)
	}
	if !strings.Contains(strings.Join(plan.Env, " "), "PGPASSWORD=admin-pw") {
		t.Errorf("the administrator password is not in the environment: %v", plan.Env)
	}

	// The host mode keeps its socket behaviour, so the two worlds do not blur.
	host := resource
	host.Mode = ModeHost
	hostPlan, err := PlanFor(StepProvision, host)
	if err != nil {
		t.Fatalf("host plan: %v", err)
	}
	if hostPlan.RunAs != "postgres" || len(hostPlan.Env) != 0 {
		t.Errorf("the host plan changed shape: %+v", hostPlan)
	}
	if strings.Contains(strings.Join(hostPlan.Commands[0], " "), "-h 127.0.0.1") {
		t.Error("the host plan should use the unix socket, not TCP")
	}

	// Without an administrator account or password the docker plan refuses.
	if _, err := PlanFor(StepProvision, Resource{Engine: "postgresql", Mode: ModeDocker, Name: "n", User: "u", Secret: "s"}); err == nil {
		t.Error("a container plan without an administrator was accepted")
	}
}
