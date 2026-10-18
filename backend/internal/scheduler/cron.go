// Package scheduler runs the daemon's built-in maintenance jobs on their cron schedules. The jobs
// are the ones the panel has always listed as "system maintenance"; before this package they were
// display-only data and nothing executed them.
package scheduler

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Schedule is a parsed five-field cron expression (minute hour day-of-month month day-of-week).
type Schedule struct {
	minute, hour, dom, month, dow map[int]bool
	domStar, dowStar              bool
}

// aliases are the @-forms the panel's own contract mentions. They expand to a normal expression so
// there is a single matcher underneath.
var aliases = map[string]string{
	"@yearly":   "0 0 1 1 *",
	"@annually": "0 0 1 1 *",
	"@monthly":  "0 0 1 * *",
	"@weekly":   "0 0 * * 0",
	"@daily":    "0 0 * * *",
	"@midnight": "0 0 * * *",
	"@hourly":   "0 * * * *",
}

var monthNames = map[string]int{
	"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
	"jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

var dowNames = map[string]int{
	"sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6,
}

// Parse parses a five-field cron expression, or one of the @-aliases above.
func Parse(spec string) (Schedule, error) {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return Schedule{}, fmt.Errorf("empty schedule")
	}
	if strings.HasPrefix(spec, "@") {
		expanded, ok := aliases[strings.ToLower(spec)]
		if !ok {
			return Schedule{}, fmt.Errorf("unknown schedule %q", spec)
		}
		spec = expanded
	}
	fields := strings.Fields(spec)
	if len(fields) != 5 {
		return Schedule{}, fmt.Errorf("expected 5 fields, got %d", len(fields))
	}

	var s Schedule
	var err error
	if s.minute, err = parseField(fields[0], 0, 59, nil); err != nil {
		return Schedule{}, fmt.Errorf("minute: %w", err)
	}
	if s.hour, err = parseField(fields[1], 0, 23, nil); err != nil {
		return Schedule{}, fmt.Errorf("hour: %w", err)
	}
	s.domStar = strings.TrimSpace(fields[2]) == "*"
	if s.dom, err = parseField(fields[2], 1, 31, nil); err != nil {
		return Schedule{}, fmt.Errorf("day-of-month: %w", err)
	}
	if s.month, err = parseField(fields[3], 1, 12, monthNames); err != nil {
		return Schedule{}, fmt.Errorf("month: %w", err)
	}
	s.dowStar = strings.TrimSpace(fields[4]) == "*"
	// Day-of-week accepts 7 as Sunday too, the way cron does.
	if s.dow, err = parseField(fields[4], 0, 7, dowNames); err != nil {
		return Schedule{}, fmt.Errorf("day-of-week: %w", err)
	}
	if s.dow[7] {
		delete(s.dow, 7)
		s.dow[0] = true
	}
	return s, nil
}

// Matches reports whether the schedule fires at t, to the minute.
func (s Schedule) Matches(t time.Time) bool {
	if !s.minute[t.Minute()] || !s.hour[t.Hour()] || !s.month[int(t.Month())] {
		return false
	}
	domMatch := s.dom[t.Day()]
	dowMatch := s.dow[int(t.Weekday())]
	switch {
	case s.domStar && s.dowStar:
		return true
	case s.domStar:
		return dowMatch
	case s.dowStar:
		return domMatch
	default:
		// Both restricted: cron matches when either does.
		return domMatch || dowMatch
	}
}

// parseField expands one field into the set of values it matches.
func parseField(field string, min, max int, names map[string]int) (map[int]bool, error) {
	set := map[int]bool{}
	for _, part := range strings.Split(field, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			return nil, fmt.Errorf("empty item in %q", field)
		}

		step := 1
		if slash := strings.IndexByte(part, '/'); slash >= 0 {
			n, err := strconv.Atoi(part[slash+1:])
			if err != nil || n <= 0 {
				return nil, fmt.Errorf("bad step in %q", part)
			}
			step = n
			part = part[:slash]
		}

		lo, hi := min, max
		switch {
		case part == "*":
			// whole range
		case strings.Contains(part, "-"):
			bounds := strings.SplitN(part, "-", 2)
			a, errA := fieldValue(bounds[0], names)
			b, errB := fieldValue(bounds[1], names)
			if errA != nil || errB != nil {
				return nil, fmt.Errorf("bad range %q", part)
			}
			lo, hi = a, b
		default:
			v, err := fieldValue(part, names)
			if err != nil {
				return nil, err
			}
			lo, hi = v, v
			if step > 1 {
				// "a/n" runs from a to the end of the range.
				hi = max
			}
		}

		if lo > hi {
			return nil, fmt.Errorf("inverted range %q", part)
		}
		if lo < min || hi > max {
			return nil, fmt.Errorf("value out of range in %q", part)
		}
		for v := lo; v <= hi; v += step {
			set[v] = true
		}
	}
	if len(set) == 0 {
		return nil, fmt.Errorf("no values in %q", field)
	}
	return set, nil
}

func fieldValue(token string, names map[string]int) (int, error) {
	token = strings.TrimSpace(token)
	if names != nil {
		if v, ok := names[strings.ToLower(token)]; ok {
			return v, nil
		}
	}
	v, err := strconv.Atoi(token)
	if err != nil {
		return 0, fmt.Errorf("invalid value %q", token)
	}
	return v, nil
}
