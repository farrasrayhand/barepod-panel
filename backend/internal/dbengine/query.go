package dbengine

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"strings"
)

// ClientQuery is one command to run a statement against a daemon engine, with the
// credential in the environment instead of the argument list.
type ClientQuery struct {
	Argv []string
	Env  []string
}

// QueryGrid is the parsed answer.
type QueryGrid struct {
	Columns   []string
	Rows      [][]string
	Truncated bool
}

// maxRows caps what a query may bring back: a careless SELECT must not fill the
// browser or the daemon.
const maxRows = 500

// QueryCommand builds the client invocation for PostgreSQL or MySQL/MariaDB.
//
// Two things matter here beyond running SQL: the password travels in the
// environment (never in argv, which anyone on the host can read) and the client is
// told to ignore its own configuration files, because the daemon runs as root and
// would otherwise pick up /root/.psqlrc or /root/.my.cnf.
func QueryCommand(engine string, resource Resource, sql string) (ClientQuery, error) {
	statement := strings.TrimSpace(sql)
	if statement == "" {
		return ClientQuery{}, errors.New("dbengine: an empty statement is not useful")
	}
	if resource.User == "" || resource.Name == "" || resource.Secret == "" {
		return ClientQuery{}, errors.New("dbengine: the database, its user and its password are all required")
	}

	switch engine {
	case "postgresql":
		return ClientQuery{
			Argv: []string{
				"psql", "-X", "-q", "--csv", "--no-psqlrc",
				"-h", adminHost(resource), "-p", fmt.Sprint(adminPort(resource)),
				"-U", resource.User, "-d", resource.Name,
				"-c", statement,
			},
			Env: []string{
				"PGPASSWORD=" + resource.Secret,
				"PGPASSFILE=/dev/null",
				"PGCONNECT_TIMEOUT=5",
			},
		}, nil
	case "mysql", "mariadb":
		binary := "mysql"
		if engine == "mariadb" {
			binary = "mariadb"
		}
		return ClientQuery{
			Argv: []string{
				binary, "--no-defaults", "--batch", "--raw", "--protocol=TCP",
				"-h", adminHost(resource), "-P", fmt.Sprint(adminPort(resource)),
				"-u", resource.User, "-D", resource.Name,
				"-e", statement,
			},
			Env: []string{"MYSQL_PWD=" + resource.Secret},
		}, nil
	}
	return ClientQuery{}, fmt.Errorf("dbengine: no query client for %q", engine)
}

// ParseQueryOutput turns the client's answer into a grid.
//
// The client is asked for a machine format on purpose: psql's `--csv` deals with
// values containing commas, quotes and newlines, and MySQL's `--batch` gives tabs
// with backslash escapes, where NULL is `\N` — parsed by hand, both would mix up
// an empty string with no value at all.
func ParseQueryOutput(engine, output string) (*QueryGrid, error) {
	switch engine {
	case "postgresql":
		return parseCSV(output)
	case "mysql", "mariadb":
		return parseBatch(output)
	}
	return nil, fmt.Errorf("dbengine: cannot parse output for %q", engine)
}

func parseCSV(output string) (*QueryGrid, error) {
	reader := csv.NewReader(strings.NewReader(strings.TrimRight(output, "\r\n")))
	reader.FieldsPerRecord = -1

	grid := &QueryGrid{Columns: []string{}, Rows: [][]string{}}
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("dbengine: the engine's answer could not be read: %w", err)
		}
		if len(grid.Columns) == 0 {
			grid.Columns = record
			continue
		}
		if len(grid.Rows) >= maxRows {
			grid.Truncated = true
			break
		}
		grid.Rows = append(grid.Rows, record)
	}
	return grid, nil
}

func parseBatch(output string) (*QueryGrid, error) {
	lines := strings.Split(strings.TrimRight(output, "\r\n"), "\n")
	grid := &QueryGrid{Columns: []string{}, Rows: [][]string{}}
	if len(lines) == 0 || (len(lines) == 1 && strings.TrimSpace(lines[0]) == "") {
		return grid, nil
	}
	grid.Columns = strings.Split(lines[0], "\t")
	for _, line := range lines[1:] {
		if strings.TrimSpace(line) == "" {
			continue
		}
		if len(grid.Rows) >= maxRows {
			grid.Truncated = true
			break
		}
		fields := strings.Split(line, "\t")
		row := make([]string, len(fields))
		for i, field := range fields {
			row[i] = unescapeBatch(field)
		}
		grid.Rows = append(grid.Rows, row)
	}
	return grid, nil
}

// unescapeBatch reverses MySQL's --batch escaping: \t, \n, \\ and \N for NULL.
func unescapeBatch(value string) string {
	if value == `\N` {
		return "NULL"
	}
	var out bytes.Buffer
	for i := 0; i < len(value); i++ {
		if value[i] != '\\' || i+1 >= len(value) {
			out.WriteByte(value[i])
			continue
		}
		i++
		switch value[i] {
		case 't':
			out.WriteByte('\t')
		case 'n':
			out.WriteByte('\n')
		case 'r':
			out.WriteByte('\r')
		case '\\':
			out.WriteByte('\\')
		case '0':
			out.WriteByte(0)
		default:
			out.WriteByte(value[i])
		}
	}
	return out.String()
}
