package api

import "testing"

func TestHookMatchesSiteRequiresSlugBoundary(t *testing.T) {
	cases := []struct {
		url  string
		slug string
		want bool
	}{
		{"https://panel.example.com/api/v1/webhooks/deploy/mae?token=x", "mae", true},
		{"https://panel.example.com/api/v1/webhooks/deploy/mae", "mae", true},
		{"https://panel.example.com/api/v1/webhook/mae/deploy?token=x", "mae", true},
		{"https://panel.example.com/api/v1/webhooks/deploy/mae2?token=x", "mae", false},
		{"https://panel.example.com/api/v1/webhooks/deploy/mae-old?token=x", "mae", false},
		{"https://panel.example.com/other", "mae", false},
	}
	for _, tc := range cases {
		if got := hookMatchesSite(tc.url, tc.slug); got != tc.want {
			t.Errorf("hookMatchesSite(%q, %q) = %v, want %v", tc.url, tc.slug, got, tc.want)
		}
	}
}

func TestRepoHostAndPathAcrossURLStyles(t *testing.T) {
	cases := []struct {
		repo string
		host string
		path string
	}{
		{"https://github.com/owner/repo.git", "github.com", "owner/repo"},
		{"git@gitlab.com:group/sub/repo.git", "gitlab.com", "group/sub/repo"},
		{"ssh://git@git.example.com:2222/team/repo.git", "git.example.com", "team/repo"},
		{"https://bitbucket.org/workspace/repo", "bitbucket.org", "workspace/repo"},
	}
	for _, tc := range cases {
		if got := repoHost(tc.repo); got != tc.host {
			t.Errorf("repoHost(%q) = %q, want %q", tc.repo, got, tc.host)
		}
		if got := repoPathAfterHost(tc.repo); got != tc.path {
			t.Errorf("repoPathAfterHost(%q) = %q, want %q", tc.repo, got, tc.path)
		}
	}
}
