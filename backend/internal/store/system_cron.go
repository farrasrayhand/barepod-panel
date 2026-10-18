package store

import (
	"database/sql"
	"errors"
)

// SystemCronJob is one built-in maintenance job: a host task the daemon runs itself on a schedule.
// The row only carries what an operator can change and what the last run produced — the label, the
// description and whether the job is implemented at all live in the daemon's job registry.
type SystemCronJob struct {
	ID         string `json:"id"`
	Enabled    bool   `json:"enabled"`
	Schedule   string `json:"schedule"` // e.g. "0 4 * * *"
	LastRunAt  string `json:"lastRunAt,omitempty"`
	LastStatus string `json:"lastStatus,omitempty"` // success | failed | skipped
	LastOutput string `json:"lastOutput,omitempty"`
	UpdatedAt  string `json:"updatedAt,omitempty"`
}

// ListSystemCronJobs returns every built-in maintenance job the daemon knows how to run.
func (s *Store) ListSystemCronJobs() ([]SystemCronJob, error) {
	rows, err := s.DB.Query(
		`SELECT id, enabled, schedule, last_run_at, last_status, last_output, updated_at
		 FROM system_cron_jobs ORDER BY id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []SystemCronJob{}
	for rows.Next() {
		var j SystemCronJob
		if err := rows.Scan(&j.ID, &j.Enabled, &j.Schedule, &j.LastRunAt, &j.LastStatus, &j.LastOutput, &j.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

// SystemCronJobByID looks up one built-in maintenance job.
func (s *Store) SystemCronJobByID(id string) (*SystemCronJob, error) {
	var j SystemCronJob
	err := s.DB.QueryRow(
		`SELECT id, enabled, schedule, last_run_at, last_status, last_output, updated_at
		 FROM system_cron_jobs WHERE id = ?`, id,
	).Scan(&j.ID, &j.Enabled, &j.Schedule, &j.LastRunAt, &j.LastStatus, &j.LastOutput, &j.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &j, nil
}

// EnsureSystemCronJobs seeds a row per known job without ever overwriting an operator's choice:
// an existing row keeps its enabled flag and schedule, so a restart (or an in-panel update) never
// silently re-enables a job somebody turned off. Safe to call on every start.
func (s *Store) EnsureSystemCronJobs(defaults []SystemCronJob) error {
	for _, job := range defaults {
		enabled := 0
		if job.Enabled {
			enabled = 1
		}
		if _, err := s.DB.Exec(
			`INSERT OR IGNORE INTO system_cron_jobs (id, enabled, schedule, updated_at)
			 VALUES (?, ?, ?, ?)`,
			job.ID, enabled, job.Schedule, now(),
		); err != nil {
			return err
		}
	}
	return nil
}

// UpdateSystemCronJob changes a job's enabled flag and/or schedule. An empty schedule leaves the
// stored one untouched.
func (s *Store) UpdateSystemCronJob(id string, enabled bool, schedule string) error {
	enabledInt := 0
	if enabled {
		enabledInt = 1
	}
	if schedule == "" {
		res, err := s.DB.Exec(`UPDATE system_cron_jobs SET enabled = ?, updated_at = ? WHERE id = ?`, enabledInt, now(), id)
		if err != nil {
			return err
		}
		if n, err := res.RowsAffected(); err == nil && n == 0 {
			return ErrNotFound
		}
		return nil
	}
	res, err := s.DB.Exec(`UPDATE system_cron_jobs SET enabled = ?, schedule = ?, updated_at = ? WHERE id = ?`, enabledInt, schedule, now(), id)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return ErrNotFound
	}
	return nil
}

// RecordSystemCronRun stores the last execution status and output for a job.
func (s *Store) RecordSystemCronRun(id, status, output string) error {
	_, err := s.DB.Exec(
		`UPDATE system_cron_jobs SET last_run_at = ?, last_status = ?, last_output = ? WHERE id = ?`,
		now(), status, output, id,
	)
	return err
}
