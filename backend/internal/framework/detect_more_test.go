package framework

import "testing"

func TestDetectMoreStacks(t *testing.T) {
	cases := []struct {
		name, title string
		fw          *DetectedFramework
	}{
		{"gin", "Gin", detectFromGoMod("require github.com/gin-gonic/gin v1.9.0")},
		{"fiber", "Fiber", detectFromGoMod("require github.com/gofiber/fiber/v2 v2.0.0")},
		{"std", "Standard HTTP", detectFromGoMod("module x")},
		{"rails", "Ruby on Rails", detectFromGemfile("gem 'rails', '~> 7.1'")},
		{"sinatra", "Sinatra", detectFromGemfile("gem \"sinatra\"")},
		{"axum", "Axum", detectFromCargo("[dependencies]\naxum = \"0.7\"")},
		{"actix", "Actix-web", detectFromCargo("actix-web = \"4\"")},
	}
	for _, c := range cases {
		if c.fw == nil || c.fw.Title != c.title {
			t.Errorf("%s: got %+v, want title %q", c.name, c.fw, c.title)
		}
	}
	deps := map[string]bool{"codeigniter4/framework": true}
	if fw := detectPHPExtra(deps, &composerJSON{}, "", "8.3"); fw == nil || fw.Title != "CodeIgniter" {
		t.Errorf("codeigniter: got %+v", fw)
	}
}
