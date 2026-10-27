package framework

import (
	"strings"
)

// phpPackages maps a Composer package to the application it identifies, most specific first.
var phpPackages = []struct {
	pkg, name, title, doc, db string
}{
	{"drupal/core-recommended", "drupal", "Drupal", "web", "mariadb"},
	{"drupal/core", "drupal", "Drupal", "web", "mariadb"},
	{"joomla/joomla-cms", "joomla", "Joomla", ".", "mariadb"},
	{"typo3/cms-core", "typo3", "TYPO3", "public", "mariadb"},
	{"contao/core-bundle", "contao", "Contao", "public", "mariadb"},
	{"neos/neos", "neos", "Neos", "Web", "mariadb"},
	{"magento/product-community-edition", "magento", "Magento", "pub", "mariadb"},
	{"prestashop/prestashop", "prestashop", "PrestaShop", ".", "mariadb"},
	{"shopware/core", "shopware", "Shopware", "public", "mariadb"},
	{"shopware/platform", "shopware", "Shopware", "public", "mariadb"},
	{"codeigniter4/framework", "codeigniter", "CodeIgniter", "public", "mariadb"},
	{"cakephp/cakephp", "cakephp", "CakePHP", "webroot", "mariadb"},
	{"slim/slim", "slim", "Slim", "public", ""},
	{"laminas/laminas-mvc", "laminas", "Laminas", "public", "mariadb"},
	{"yiisoft/yii2", "yii", "Yii", "web", "mariadb"},
	{"mautic/core-lib", "mautic", "Mautic", "docroot", "mariadb"},
	{"matomo/matomo", "matomo", "Matomo", ".", "mariadb"},
}

// detectPHPExtra recognises the Composer applications beyond Laravel, Symfony and Bedrock.
func detectPHPExtra(allDeps map[string]bool, c *composerJSON, dir, phpVer string) *DetectedFramework {
	for _, p := range phpPackages {
		if !allDeps[p.pkg] {
			continue
		}
		title := p.title
		if _, major := extractComposerPackageVersion(dir, c, p.pkg); major != "" {
			title += " " + major
		}
		return &DetectedFramework{
			Name:           p.name,
			Title:          title,
			Runtime:        "php",
			Version:        phpVer,
			PackageManager: "composer",
			DocRoot:        p.doc,
			BuildCommand:   "composer install --no-dev --optimize-autoloader",
			DatabaseEngine: p.db,
			Port:           8001,
		}
	}
	return nil
}

// detectFromGoMod names the Go web framework when go.mod requires one.
func detectFromGoMod(content string) *DetectedFramework {
	title := "Standard HTTP"
	lower := strings.ToLower(content)
	switch {
	case strings.Contains(lower, "gin-gonic/gin"):
		title = "Gin"
	case strings.Contains(lower, "gofiber/fiber"):
		title = "Fiber"
	}
	return &DetectedFramework{
		Name:           "go",
		Title:          title,
		Runtime:        "go",
		Version:        "1.22",
		BuildCommand:   "go build -o app .",
		StartCommand:   "./app",
		Port:           8080,
		DocRoot:        ".",
		IsProxy:        true,
		DatabaseEngine: "postgres",
	}
}

// detectFromGemfile recognises Rails and Sinatra.
func detectFromGemfile(content string) *DetectedFramework {
	lower := strings.ToLower(content)
	title, name := "", ""
	switch {
	case strings.Contains(lower, "'rails'") || strings.Contains(lower, "\"rails\""):
		title, name = "Ruby on Rails", "rails"
	case strings.Contains(lower, "sinatra"):
		title, name = "Sinatra", "sinatra"
	default:
		return nil
	}
	fw := &DetectedFramework{
		Name:           name,
		Title:          title,
		Runtime:        "ruby",
		Version:        "3.3",
		PackageManager: "bundler",
		DocRoot:        ".",
		BuildCommand:   "bundle install",
		Port:           3000,
		IsProxy:        true,
		DatabaseEngine: "postgres",
	}
	if name == "rails" {
		fw.StartCommand = "bundle exec rails server -b 127.0.0.1 -p 3000"
	} else {
		fw.StartCommand = "bundle exec ruby app.rb -o 127.0.0.1 -p 3000"
	}
	return fw
}

// detectFromCargo recognises Axum and Actix-web, and any other Rust binary.
func detectFromCargo(content string) *DetectedFramework {
	lower := strings.ToLower(content)
	title := "Rust Application"
	switch {
	case strings.Contains(lower, "axum"):
		title = "Axum"
	case strings.Contains(lower, "actix-web"):
		title = "Actix-web"
	}
	return &DetectedFramework{
		Name:         "rust",
		Title:        title,
		Runtime:      "rust",
		Version:      "stable",
		BuildCommand: "cargo build --release",
		Port:         8080,
		DocRoot:      ".",
		IsProxy:      true,
	}
}
