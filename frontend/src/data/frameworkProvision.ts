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

const laravelPlan = (version?: string): ProvisionPlan => {
  const major = (version || '11').split('.')[0].replace(/[^0-9]/g, '') || '11';
  return {
    mode: 'download',
    install: `composer create-project laravel/laravel:^${major} .`,
    steps: [
      'composer install --no-dev --optimize-autoloader',
      'php artisan key:generate',
      'php artisan migrate --force',
      'php artisan db:seed --force',
      'npm install && npm run build',
      'php artisan config:cache && php artisan route:cache',
    ],
    note: `Downloads Laravel ^${major} and wires the generated .env to the provisioned database.`,
  };
};

const wordpressPlan: ProvisionPlan = {
  mode: 'download',
  install: 'wp core download --locale=en_US',
  steps: [
    'wp core config --dbname=$DB --dbuser=$DB_USER --dbpass=$DB_PASS',
    'wp core install --url=$DOMAIN --title="$SITE_NAME" --admin_user=$DB_USER --admin_email=admin@$DOMAIN',
    'wp plugin install woocommerce --activate   # WooCommerce only',
    'wp rewrite structure "/%postname%/" --hard',
  ],
  note: 'Downloads WordPress core and runs the installer automatically (admin account = database user).',
};

export const getProvisionPlan = (runtime: RuntimeType, framework: string, version: string): ProvisionPlan => {
  const f = (framework || '').toLowerCase();

  if (f.includes('generic') || f.includes('custom') || f.includes('static')) return GENERIC;

  if (runtime === 'php') {
    if (f.includes('laravel')) return laravelPlan(version);
    if (f.includes('wordpress') || f.includes('woocommerce')) return wordpressPlan;
    if (f.includes('symfony')) {
      return {
        mode: 'download',
        install: `composer create-project symfony/skeleton:"${version}.*" .`,
        steps: ['composer install', 'php bin/console doctrine:migrations:migrate --no-interaction'],
        note: `Downloads Symfony ${version} skeleton.`,
      };
    }
    if (f.includes('drupal')) {
      return {
        mode: 'download',
        install: `composer create-project drupal/recommended-project:^${version} .`,
        steps: ['composer install', 'drush site:install --db-url=$DATABASE_URL -y'],
        note: `Downloads Drupal ${version}.`,
      };
    }
    if (f.includes('codeigniter')) {
      return {
        mode: 'download',
        install: 'composer create-project codeigniter4/appstarter .',
        steps: ['composer install', 'php spark migrate'],
        note: 'Downloads CodeIgniter 4 starter.',
      };
    }
    return {
      mode: 'generic',
      install: '',
      steps: ['composer install'],
      note: 'No automated download for this PHP template — upload/clone your project, then Composer installs dependencies.',
    };
  }

  if (runtime === 'nodejs') {
    if (f.includes('next')) {
      return {
        mode: 'download',
        install: 'npx create-next-app@latest . --ts --app --eslint --src-dir --use-npm',
        steps: ['npm install', 'npm run build'],
        note: 'Scaffolds a new Next.js app.',
      };
    }
    if (f.includes('nuxt')) {
      return { mode: 'download', install: 'npx nuxi@latest init .', steps: ['npm install', 'npm run build'], note: 'Scaffolds a new Nuxt app.' };
    }
    if (f.includes('astro')) {
      return { mode: 'download', install: 'npm create astro@latest . -- --template minimal', steps: ['npm install', 'npm run build'], note: 'Scaffolds a new Astro project.' };
    }
    if (f.includes('express') || f.includes('nest')) {
      return { mode: 'generic', install: '', steps: ['npm install', 'npm run build'], note: 'Bring your own Node project — dependencies are installed automatically.' };
    }
    return { mode: 'generic', install: '', steps: ['npm install'], note: 'Bring your own Node project.' };
  }

  if (runtime === 'python') {
    if (f.includes('custom') || f.includes('generic')) return GENERIC;
    const pkg = f.includes('flask') ? 'Flask' : f.includes('fastapi') ? 'FastAPI' : f.includes('django') ? 'Django' : '';
    if (!pkg) return GENERIC;
    return {
      mode: 'generic',
      install: '',
      steps: [`python -m venv venv`, `. venv/bin/activate && pip install ${pkg}`, 'pip install -r requirements.txt --quiet'],
      note: 'Create the virtualenv and install the framework; app code is yours.',
    };
  }

  if (runtime === 'ruby') {
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
