package store

import (
	"database/sql"
	"errors"
	"time"
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
	// Trigger records what started the run: manual | redeploy | webhook | poll.
	Trigger string `json:"trigger,omitempty"`
	// The built commit, filled in after the source step when the site is a Git checkout.
	CommitSHA     string `json:"commit,omitempty"`
	CommitMessage string `json:"commitMessage,omitempty"`
	CommitAuthor  string `json:"commitAuthor,omitempty"`
	DurationMs    int64  `json:"durationMs"`
	CreatedAt     string `json:"createdAt"`
	FinishedAt    string `json:"finishedAt,omitempty"`
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
		`INSERT INTO deploy_jobs (id, slug, website_id, mode, status, step, total_steps, current_step, error,
		                          trigger_source, commit_sha, commit_message, commit_author, duration_ms, created_at, finished_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		j.ID, j.Slug, j.WebsiteID, j.Mode, j.Status, j.Step, j.TotalSteps, j.CurrentStep, j.Error,
		j.Trigger, j.CommitSHA, j.CommitMessage, j.CommitAuthor, j.DurationMs, j.CreatedAt, j.FinishedAt,
	)
	return err
}

// UpdateDeployJob persists progress and outcome of a job.
// InterruptRunningStackJobs marks jobs that never reached a terminal state, which is what a
// daemon restart leaves behind. Their steps ran under systemd and may well have finished,
// so the reason says that instead of the row reading "running" forever.
func (s *Store) InterruptRunningStackJobs(slug, reason string) (int, error) {
	res, err := s.DB.Exec(
		`UPDATE deploy_jobs SET status = 'failed', error = ?, finished_at = ?
		 WHERE slug = ? AND status IN ('pending', 'running')`,
		reason, time.Now().UTC().Format(time.RFC3339), slug,
	)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

func (s *Store) UpdateDeployJob(j *DeployJob) error {
	_, err := s.DB.Exec(
		`UPDATE deploy_jobs SET status = ?, step = ?, total_steps = ?, current_step = ?, error = ?,
		                        trigger_source = ?, commit_sha = ?, commit_message = ?, commit_author = ?,
		                        duration_ms = ?, finished_at = ?
		 WHERE id = ?`,
		j.Status, j.Step, j.TotalSteps, j.CurrentStep, j.Error,
		j.Trigger, j.CommitSHA, j.CommitMessage, j.CommitAuthor, j.DurationMs, j.FinishedAt, j.ID,
	)
	return err
}

func scanDeployJob(row *sql.Row) (*DeployJob, error) {
	var j DeployJob
	err := row.Scan(&j.ID, &j.Slug, &j.WebsiteID, &j.Mode, &j.Status, &j.Step, &j.TotalSteps,
		&j.CurrentStep, &j.Error, &j.Trigger, &j.CommitSHA, &j.CommitMessage, &j.CommitAuthor,
		&j.DurationMs, &j.CreatedAt, &j.FinishedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &j, nil
}

const deployJobColumns = `id, slug, website_id, mode, status, step, total_steps, current_step, error,
	trigger_source, commit_sha, commit_message, commit_author, duration_ms, created_at, finished_at`

// DeployJob loads a job by id.
func (s *Store) DeployJob(jobID string) (*DeployJob, error) {
	return scanDeployJob(s.DB.QueryRow(`SELECT `+deployJobColumns+` FROM deploy_jobs WHERE id = ?`, jobID))
}

// LatestDeployJob returns the most recent job for a website slug.
func (s *Store) LatestDeployJob(slug string) (*DeployJob, error) {
	return scanDeployJob(s.DB.QueryRow(
		`SELECT `+deployJobColumns+` FROM deploy_jobs WHERE slug = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`, slug))
}

// ListDeployJobs returns a website's recent jobs, newest first. The pipeline prunes to the newest
// ten per site, so this is also the deployment history the Deploy tab shows.
func (s *Store) ListDeployJobs(slug string, limit int) ([]DeployJob, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.DB.Query(
		`SELECT `+deployJobColumns+` FROM deploy_jobs WHERE slug = ?
		 ORDER BY created_at DESC, rowid DESC LIMIT ?`, slug, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []DeployJob{}
	for rows.Next() {
		var j DeployJob
		if err := rows.Scan(&j.ID, &j.Slug, &j.WebsiteID, &j.Mode, &j.Status, &j.Step, &j.TotalSteps,
			&j.CurrentStep, &j.Error, &j.Trigger, &j.CommitSHA, &j.CommitMessage, &j.CommitAuthor,
			&j.DurationMs, &j.CreatedAt, &j.FinishedAt); err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
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

// SetWebsiteWebServer records the engine a site is served by after it is switched.
func (s *Store) SetWebsiteWebServer(slug, engine string) error {
	_, err := s.DB.Exec(`UPDATE websites SET web_server = ? WHERE slug = ?`, engine, slug)
	return err
}
