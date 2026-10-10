package store

import (
	"database/sql"
	"errors"
)

// DeployJob is one deployment attempt for a website.
// Mode is "real" on a Linux host with systemd, "dry-run" elsewhere.
type DeployJob struct {
	ID          string `json:"id"`
	Slug        string `json:"slug"`
	WebsiteID   string `json:"websiteId,omitempty"`
	Mode        string `json:"mode"`
	Status      string `json:"status"` // pending | running | success | failed
	Step        int    `json:"step"`
	TotalSteps  int    `json:"totalSteps"`
	CurrentStep string `json:"currentStep"`
	Error       string `json:"error,omitempty"`
	CreatedAt   string `json:"createdAt"`
	FinishedAt  string `json:"finishedAt,omitempty"`
}

// DeployLog is a single streamed line of a deployment.
type DeployLog struct {
	ID     int64  `json:"id"`
	JobID  string `json:"jobId"`
	TS     string `json:"ts"`
	Stream string `json:"stream"` // stdout | stderr | step
	Line   string `json:"line"`
}

// CreateDeployJob inserts a new job row.
func (s *Store) CreateDeployJob(j *DeployJob) error {
	_, err := s.DB.Exec(
		`INSERT INTO deploy_jobs (id, slug, website_id, mode, status, step, total_steps, current_step, error, created_at, finished_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		j.ID, j.Slug, j.WebsiteID, j.Mode, j.Status, j.Step, j.TotalSteps, j.CurrentStep, j.Error, j.CreatedAt, j.FinishedAt,
	)
	return err
}

// UpdateDeployJob persists progress and outcome of a job.
func (s *Store) UpdateDeployJob(j *DeployJob) error {
	_, err := s.DB.Exec(
		`UPDATE deploy_jobs SET status = ?, step = ?, total_steps = ?, current_step = ?, error = ?, finished_at = ?
		 WHERE id = ?`,
		j.Status, j.Step, j.TotalSteps, j.CurrentStep, j.Error, j.FinishedAt, j.ID,
	)
	return err
}

func scanDeployJob(row *sql.Row) (*DeployJob, error) {
	var j DeployJob
	err := row.Scan(&j.ID, &j.Slug, &j.WebsiteID, &j.Mode, &j.Status, &j.Step, &j.TotalSteps,
		&j.CurrentStep, &j.Error, &j.CreatedAt, &j.FinishedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &j, nil
}

const deployJobColumns = `id, slug, website_id, mode, status, step, total_steps, current_step, error, created_at, finished_at`

// DeployJob loads a job by id.
func (s *Store) DeployJob(jobID string) (*DeployJob, error) {
	return scanDeployJob(s.DB.QueryRow(`SELECT `+deployJobColumns+` FROM deploy_jobs WHERE id = ?`, jobID))
}

// LatestDeployJob returns the most recent job for a website slug.
func (s *Store) LatestDeployJob(slug string) (*DeployJob, error) {
	return scanDeployJob(s.DB.QueryRow(
		`SELECT `+deployJobColumns+` FROM deploy_jobs WHERE slug = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`, slug))
}

// AppendDeployLog stores one log line and returns its sequence id.
func (s *Store) AppendDeployLog(jobID, stream, line string) (int64, error) {
	res, err := s.DB.Exec(
		`INSERT INTO deploy_logs (job_id, ts, stream, line) VALUES (?, ?, ?, ?)`,
		jobID, now(), stream, line,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// DeployLogs returns the log lines of a job with an id greater than afterID.
func (s *Store) DeployLogs(jobID string, afterID int64) ([]DeployLog, error) {
	rows, err := s.DB.Query(
		`SELECT id, job_id, ts, stream, line FROM deploy_logs WHERE job_id = ? AND id > ? ORDER BY id ASC`,
		jobID, afterID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []DeployLog{}
	for rows.Next() {
		var l DeployLog
		if err := rows.Scan(&l.ID, &l.JobID, &l.TS, &l.Stream, &l.Line); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// SetWebsiteRuntimeState updates the live status of a website.
func (s *Store) SetWebsiteRuntimeState(slug, status, deployStatus string) error {
	_, err := s.DB.Exec(`UPDATE websites SET status = ?, deploy_status = ? WHERE slug = ?`, status, deployStatus, slug)
	return err
}
