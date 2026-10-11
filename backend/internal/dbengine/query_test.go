package dbengine

import (
	"strings"
	"testing"

	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
)

func TestQueryCommandKeepsThePasswordOutOfArgv(t *testing.T) {
	postgresSecret := id.Token(16)
	postgres, err := QueryCommand("postgresql", Resource{
		User: "shop_user", Name: "shop", Secret: postgresSecret, AdminHost: "127.0.0.1", AdminPort: 5432,
	}, "SELECT 1")
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(postgres.Argv, " ")
	if strings.Contains(joined, postgresSecret) {
		t.Errorf("the password reached the argument list: %s", joined)
	}
	for _, want := range []string{"-X", "--csv", "--no-psqlrc", "-U shop_user", "-d shop"} {
		if !strings.Contains(joined, want) {
			t.Errorf("the command is missing %q: %s", want, joined)
		}
	}
	env := strings.Join(postgres.Env, " ")
	if !strings.Contains(env, "PGPASSWORD="+postgresSecret) {
		t.Errorf("the password is not in the environment: %s", env)
	}
	// Root's own files must not be able to change what runs or where it connects.
	if !strings.Contains(env, "PGPASSFILE=/dev/null") {
		t.Errorf("psql may read root's password file: %s", env)
	}

	mysqlSecret := id.Token(16) + "'with"
	mysql, err := QueryCommand("mysql", Resource{
		User: "shop_user", Name: "shop", Secret: mysqlSecret, AdminHost: "127.0.0.1", AdminPort: 3306,
	}, "SELECT 1")
	if err != nil {
		t.Fatal(err)
	}
	mysqlArgv := strings.Join(mysql.Argv, " ")
	if strings.Contains(mysqlArgv, mysqlSecret) {
		t.Errorf("the password reached the argument list: %s", mysqlArgv)
	}
	for _, want := range []string{"--no-defaults", "--batch", "--raw", "--protocol=TCP", "-u shop_user", "-D shop"} {
		if !strings.Contains(mysqlArgv, want) {
			t.Errorf("the command is missing %q: %s", want, mysqlArgv)
		}
	}
	if !strings.Contains(strings.Join(mysql.Env, " "), "MYSQL_PWD="+mysqlSecret) {
		t.Errorf("the password is not in the environment: %v", mysql.Env)
	}

	// Nothing to run means an error, not an empty statement.
	if _, err := QueryCommand("postgresql", Resource{User: "u", Name: "n", Secret: "s"}, "   "); err == nil {
		t.Error("an empty statement was accepted")
	}
	if _, err := QueryCommand("mongodb", Resource{User: "u", Name: "n", Secret: "s"}, "SELECT 1"); err == nil {
		t.Error("an engine without a query client was accepted")
	}
}

func TestParsePostgresCSVKeepsValuesAndNulls(t *testing.T) {
	output := "id,title,note\n" +
		"1,\"hello, world\",\n" +
		"2,\"line one\nline two\",NULL\n" +
		"3,\"quote \"\" inside\",done\n"

	grid, err := ParseQueryOutput("postgresql", output)
	if err != nil {
		t.Fatal(err)
	}
	if len(grid.Columns) != 3 || grid.Columns[1] != "title" {
		t.Fatalf("columns = %v", grid.Columns)
	}
	if len(grid.Rows) != 3 {
		t.Fatalf("rows = %v", grid.Rows)
	}
	if grid.Rows[0][1] != "hello, world" {
		t.Errorf("a comma inside a value was split: %v", grid.Rows[0])
	}
	if grid.Rows[1][1] != "line one\nline two" {
		t.Errorf("a newline inside a value was lost: %q", grid.Rows[1][1])
	}
	if grid.Rows[2][1] != `quote " inside` {
		t.Errorf("a quoted quote was mangled: %q", grid.Rows[2][1])
	}
}

func TestParseMySQLBatchDistinguishesNullFromEmpty(t *testing.T) {
	output := "id\ttitle\tnote\n" +
		"1\thello\t\n" + // empty string
		"2\twith\\ttab\t\\N\n" + // an escaped tab, and NULL
		"3\twith\\nnewline\tok\n" // an escaped newline

	grid, err := ParseQueryOutput("mysql", output)
	if err != nil {
		t.Fatal(err)
	}
	if len(grid.Rows) != 3 {
		t.Fatalf("rows = %v", grid.Rows)
	}
	if grid.Rows[0][2] != "" {
		t.Errorf("an empty value should stay empty: %q", grid.Rows[0][2])
	}
	if grid.Rows[1][1] != "with\ttab" {
		t.Errorf("the escaped tab was not decoded: %q", grid.Rows[1][1])
	}
	if grid.Rows[1][2] != "NULL" {
		t.Errorf("\\N should be NULL, got %q", grid.Rows[1][2])
	}
	if grid.Rows[2][1] != "with\nnewline" {
		t.Errorf("the escaped newline was not decoded: %q", grid.Rows[2][1])
	}
}

func TestParseCapsWhatItReturns(t *testing.T) {
	var builder strings.Builder
	builder.WriteString("id\n")
	for i := 0; i < maxRows+25; i++ {
		builder.WriteString("x\n")
	}
	grid, err := ParseQueryOutput("postgresql", builder.String())
	if err != nil {
		t.Fatal(err)
	}
	if len(grid.Rows) != maxRows || !grid.Truncated {
		t.Errorf("rows = %d, truncated = %v", len(grid.Rows), grid.Truncated)
	}
}
