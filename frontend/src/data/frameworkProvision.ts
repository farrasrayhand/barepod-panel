import type { RuntimeType } from '../types';

export interface ProvisionPlan {
  mode: 'download' | 'generic';
  install: string;
  steps: string[];
  note: string;
}

const GENERIC: ProvisionPlan = {
  mode: 'generic',
  install: '',
  steps: [],
  note: 'Bring your own code — nothing is downloaded. Point the runtime at your existing project.',
};

/** Pull the framework's own major version from its label (e.g. "Laravel 12" -> 12). */
const frameworkMajor = (framework: string): string => {
  const match = framework.match(/(\d+)/);
  return match ? match[1] : '';
};

export const getProvisionPlan = (runtime: RuntimeType, framework: string, frameworkVersion?: string): ProvisionPlan => {
  const f = (framework || '').toLowerCase();
  const v = (frameworkVersion || '').trim();

  if (f.includes('generic') || f.includes('custom')) return GENERIC;

  if (runtime === 'php') {
    if (f.includes('laravel')) {
      const major = v || frameworkMajor(framework) || '12';
      return {
        mode: 'download',
        install: `composer create-project laravel/laravel:^${major} .`,
        steps: [
          'composer install --no-dev --optimize-autoloader',
          'php artisan key:generate --force',
          'php artisan migrate --force || true',
          'npm install && npm run build || true',
          'php artisan config:cache && php artisan route:cache || true',
        ],
        note: `Downloads Laravel ^${major} and wires the generated .env to the provisioned database.`,
      };
    }
    if (f.includes('wordpress') || f.includes('woocommerce')) {
      return {
        mode: 'download',
        install: 'wp core download',
        steps: [],
        note: 'Downloads WordPress core and configures wp-config.php automatically. You can complete the setup directly in your browser.',
      };
    }
    if (f.includes('symfony')) {
      const major = v || frameworkMajor(framework) || '7';
      return {
        mode: 'download',
        install: `composer create-project symfony/skeleton:"${major}.*" .`,
        steps: ['composer install', 'php bin/console doctrine:migrations:migrate --no-interaction'],
        note: `Downloads the Symfony ${major} skeleton.`,
      };
    }
    if (f.includes('drupal')) {
      const major = v || frameworkMajor(framework) || '11';
      return {
        mode: 'download',
        install: `composer create-project drupal/recommended-project:^${major} .`,
        steps: ['composer install', 'drush site:install --db-url=$DATABASE_URL -y'],
        note: `Downloads Drupal ${major}.`,
      };
    }
    if (f.includes('codeigniter')) {
      return {
        mode: 'download',
        install: 'composer create-project codeigniter4/appstarter .',
        steps: ['composer install', 'php spark migrate'],
        note: 'Downloads the CodeIgniter 4 starter app.',
      };
    }
    if (f.includes('cakephp')) {
      return {
        mode: 'download',
        install: 'composer create-project --prefer-dist cakephp/app .',
        steps: ['composer install', 'bin/cake migrations migrate'],
        note: 'Downloads the CakePHP application skeleton.',
      };
    }
    return {
      mode: 'generic',
      install: '',
      steps: ['composer install'],
      note: 'No automated download for this PHP template — use GitHub or Upload, then Composer installs dependencies.',
    };
  }

  if (runtime === 'nodejs') {
    if (f.includes('next')) {
      const verTag = v ? `@${v}` : '@latest';
      return {
        mode: 'download',
        install: `npx create-next-app${verTag} . --ts --app --eslint --src-dir --use-npm`,
        steps: ['npm install', 'npm run build'],
        note: `Scaffolds a new Next.js ${v || 'latest'} app (runtime Node version is selected separately).`,
      };
    }
    if (f.includes('nuxt')) {
      return { mode: 'download', install: 'npx nuxi@latest init .', steps: ['npm install', 'npm run build'], note: 'Scaffolds a new Nuxt app.' };
    }
    if (f.includes('astro')) {
      return { mode: 'download', install: 'npm create astro@latest . -- --template minimal', steps: ['npm install', 'npm run build'], note: 'Scaffolds a new Astro project.' };
    }
    if (f.includes('nest')) {
      return { mode: 'download', install: 'npx @nestjs/cli@latest new . --package-manager npm --skip-git', steps: ['npm install', 'npm run build'], note: 'Scaffolds a new NestJS project.' };
    }
    if (f.includes('express')) {
      const pkg = v === '5' ? 'express-generator@next' : 'express-generator@latest';
      return { mode: 'download', install: `npx ${pkg} .`, steps: ['npm install'], note: `Scaffolds an Express ${v || '4'} app skeleton.` };
    }
    return { mode: 'generic', install: '', steps: ['npm install', 'npm run build'], note: 'Bring your own Node project — dependencies are installed automatically.' };
  }

  if (runtime === 'python') {
    if (f.includes('django')) {
      const dVer = v ? `~=${v}.0` : '';
      return {
        mode: 'download',
        install: `python -m venv venv && . venv/bin/activate && pip install "django${dVer}" && django-admin startproject config .`,
        steps: ['pip install -r requirements.txt --quiet', 'python manage.py migrate --noinput'],
        note: `Creates a virtualenv and scaffolds a new Django ${v || 'latest'} project.`,
      };
    }
    const pkg = f.includes('flask') ? 'Flask' : f.includes('fastapi') ? 'FastAPI' : '';
    if (!pkg) return GENERIC;
    return {
      mode: 'generic',
      install: '',
      steps: ['python -m venv venv', `. venv/bin/activate && pip install ${pkg}`, 'pip install -r requirements.txt --quiet'],
      note: `Creates the virtualenv and installs ${pkg}; app code is yours.`,
    };
  }

  if (runtime === 'ruby') {
    if (f.includes('rails')) {
      const rVer = v ? `-v "~> ${v}.0"` : '';
      return {
        mode: 'download',
        install: `gem install rails ${rVer} && rails new . --skip-bundle --database=$DB_ADAPTER`,
        steps: ['bundle install', 'bin/rails db:migrate'],
        note: `Scaffolds a new Ruby on Rails ${v || 'latest'} application.`,
      };
    }
    return { mode: 'generic', install: '', steps: ['bundle install'], note: 'Gemfile dependencies are installed automatically.' };
  }

  if (runtime === 'go') {
    return { mode: 'generic', install: '', steps: ['go mod download', 'go build -o app .'], note: 'Go modules are downloaded and the binary is built.' };
  }

  if (runtime === 'rust') {
    return { mode: 'generic', install: '', steps: ['cargo build --release'], note: 'Cargo builds the release binary.' };
  }

  return GENERIC;
};
