package scheduler

import (
	"testing"
	"time"
)

// dt builds a UTC time. Dates below are March 2026, where the 1st is a Sunday, the 2nd and 9th are
// Mondays and the 10th is a Tuesday.
func dt(day, hour, min int) time.Time {
	return time.Date(2026, time.March, day, hour, min, 0, 0, time.UTC)
}

func TestParseAndMatch(t *testing.T) {
	cases := []struct {
		spec  string
		when  time.Time
		match bool
	}{
		{"*/5 * * * *", dt(2, 10, 5), true},
		{"*/5 * * * *", dt(2, 10, 6), false},
		{"0 4 * * *", dt(10, 4, 0), true},
		{"0 4 * * *", dt(10, 5, 0), false},
		{"0 0,12 * * *", dt(10, 12, 0), true},
		{"0 0,12 * * *", dt(10, 13, 0), false},
		{"@daily", dt(10, 0, 0), true},
		{"@daily", dt(10, 0, 1), false},
		{"@hourly", dt(10, 3, 0), true},
		// day-of-week: 0 and 7 both mean Sunday.
		{"0 0 * * 0", dt(1, 0, 0), true},
		{"0 0 * * 7", dt(1, 0, 0), true},
		{"0 0 * * 1", dt(1, 0, 0), false},
		// both day fields restricted: cron matches when either does.
		{"0 0 1 * 1", dt(9, 0, 0), true},  // a Monday that is not the 1st
		{"0 0 1 * 1", dt(1, 0, 0), true},  // the 1st, which is not a Monday
		{"0 0 1 * 1", dt(8, 0, 0), false}, // neither the 1st nor a Monday
		// ranges and names.
		{"0 9-17 * * mon-fri", dt(10, 9, 0), true},
		{"0 9-17 * * mon-fri", dt(10, 18, 0), false},
	}
	for _, tc := range cases {
		sched, err := Parse(tc.spec)
		if err != nil {
			t.Fatalf("Parse(%q) returned error: %v", tc.spec, err)
		}
		if got := sched.Matches(tc.when); got != tc.match {
			t.Errorf("Parse(%q).Matches(%s) = %v, want %v", tc.spec, tc.when.Format(time.RFC3339), got, tc.match)
		}
	}
}

func TestParseRejectsBadSpecs(t *testing.T) {
	for _, spec := range []string{"", "* * *", "60 * * * *", "*/0 * * * *", "* * * * * *", "1-5-7 * * * *", "@never", "abc * * * *"} {
		if _, err := Parse(spec); err == nil {
			t.Errorf("Parse(%q) should have failed", spec)
		}
	}
}
