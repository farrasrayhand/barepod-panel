package store

// PruneDeployJobs keeps the newest keep jobs of a website and deletes the older
// ones together with their log lines, so a site that redeploys often cannot
// grow the database without bound. It returns how many jobs were removed.
func (s *Store) PruneDeployJobs(slug string, keep int) (int, error) {
	if keep < 0 {
		keep = 0
	}

	var total int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM deploy_jobs WHERE slug = ?`, slug).Scan(&total); err != nil {
		return 0, err
	}
	if total <= keep {
		return 0, nil
	}

	// Log lines first (the subquery must still see the jobs row).
	if _, err := s.DB.Exec(
		`DELETE FROM deploy_logs WHERE job_id IN (
			SELECT id FROM deploy_jobs WHERE slug = ? ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?)`,
		slug, keep,
	); err != nil {
		return 0, err
	}

	res, err := s.DB.Exec(
		`DELETE FROM deploy_jobs WHERE slug = ? AND id NOT IN (
			SELECT id FROM deploy_jobs WHERE slug = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)`,
		slug, slug, keep,
	)
	if err != nil {
		return 0, err
	}
	removed, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}
	return int(removed), nil
}

// CountDeployJobs returns how many deploy jobs a website has recorded.
func (s *Store) CountDeployJobs(slug string) (int, error) {
	var n int
	err := s.DB.QueryRow(`SELECT COUNT(*) FROM deploy_jobs WHERE slug = ?`, slug).Scan(&n)
	return n, err
}
