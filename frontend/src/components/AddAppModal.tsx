import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Layers,
  Globe,
  Terminal,
  CloudRain,
  ShieldCheck,
  Database,
  Check,
  Server,
  Zap,
  ArrowRightLeft,
  Wifi,
  Copy,
  Code2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  RefreshCw,
  Upload,
  Download,
  FolderOpen,
  FolderPlus,
  Lock,
  GitBranch,
  KeyRound,
  AlertCircle,
  AlertTriangle,
  User,
} from 'lucide-react';
import type { RuntimeType, WebApp, WebServerType, DatabaseEngine } from '../types';
import { runtimeIcon, dbIcon } from '../utils/brandIcons';
import { AVAILABLE_ENGINE_VERSIONS, ENGINE_LABELS } from '../data/databaseEngines';
import { getProvisionPlan } from '../data/frameworkProvision';
import { api, apiReachable, ApiError, type StackStatus, type DetectedFramework } from '../api/client';

interface AddAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * The archive is handed over as well: an "Upload Archive" source is only real if those
   * bytes reach the website, and the caller is what talks to the daemon.
   */
  onAddApp: (newApp: Partial<WebApp>, archive?: File) => Promise<void> | void;
  currentUsername?: string;
  isAdmin?: boolean;
  existingApps?: WebApp[];
}

type WizardStep = 'basics' | 'source' | 'engine' | 'database' | 'upstream' | 'review';
type SourceKind = 'scaffold' | 'github' | 'upload' | 'existing' | 'default';

export interface FrameworkVersionOption {
  value: string;
  label: string;
  badge?: string;
  minRuntime?: string;
}

export interface ScaffoldPreset {
  id: string;
  name: string;
  runtime: RuntimeType;
  defaultVersion: string;
  frameworkVersions?: FrameworkVersionOption[];
  defaultFrameworkVersion?: string;
  category: string;
  desc: string;
  databaseEngine?: DatabaseEngine;
  cacheEngine?: string;
}

export const POPULAR_SCAFFOLDS: ScaffoldPreset[] = [
  {
    id: 'laravel',
    name: 'Laravel',
    runtime: 'php',
    defaultVersion: '8.4',
    frameworkVersions: [
      { value: '13', label: '13', badge: 'Next / Dev', minRuntime: '8.3' },
      { value: '12', label: '12', badge: 'Latest', minRuntime: '8.2' },
      { value: '11', label: '11', badge: 'LTS', minRuntime: '8.2' },
      { value: '10', label: '10', minRuntime: '8.1' },
    ],
    defaultFrameworkVersion: '12',
    category: 'PHP',
    desc: 'Modern PHP web framework with artisan, migrations, queue',
    databaseEngine: 'mariadb',
    cacheEngine: 'redis',
  },
  {
    id: 'symfony',
    name: 'Symfony',
    runtime: 'php',
    defaultVersion: '8.3',
    frameworkVersions: [
      { value: '8', label: '8', badge: 'Next', minRuntime: '8.3' },
      { value: '7', label: '7', badge: 'Current', minRuntime: '8.2' },
      { value: '6.4', label: '6.4', badge: 'LTS', minRuntime: '8.1' },
    ],
    defaultFrameworkVersion: '7',
    category: 'PHP',
    desc: 'Enterprise-grade PHP web framework',
    databaseEngine: 'mariadb',
  },
  {
    id: 'wordpress',
    name: 'WordPress',
    runtime: 'php',
    defaultVersion: '8.3',
    frameworkVersions: [
      { value: 'latest', label: 'Latest', badge: 'Auto-Update' },
    ],
    defaultFrameworkVersion: 'latest',
    category: 'PHP',
    desc: 'World most popular CMS with WP-CLI auto-setup',
    databaseEngine: 'mariadb',
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    runtime: 'php',
    defaultVersion: '8.3',
    frameworkVersions: [
      { value: 'latest', label: 'Latest', badge: 'Auto-Update' },
    ],
    defaultFrameworkVersion: 'latest',
    category: 'PHP',
    desc: 'E-commerce platform for WordPress',
    databaseEngine: 'mariadb',
  },
  {
    id: 'nextjs',
    name: 'Next.js',
    runtime: 'nodejs',
    defaultVersion: '20',
    frameworkVersions: [
      { value: '15', label: '15', badge: 'React 19', minRuntime: '18.18' },
      { value: '14', label: '14', badge: 'Stable', minRuntime: '18.17' },
      { value: '13', label: '13', minRuntime: '16.14' },
    ],
    defaultFrameworkVersion: '15',
    category: 'Node.js',
    desc: 'React framework with SSR & API routes',
    databaseEngine: 'postgres',
  },
  {
    id: 'fastapi',
    name: 'FastAPI',
    runtime: 'python',
    defaultVersion: '3.11',
    frameworkVersions: [
      { value: 'latest', label: 'Latest', badge: 'Async API' },
    ],
    defaultFrameworkVersion: 'latest',
    category: 'Python',
    desc: 'Modern high performance Python async API',
    databaseEngine: 'postgres',
  },
  {
    id: 'express',
    name: 'Express',
    runtime: 'nodejs',
    defaultVersion: '20',
    frameworkVersions: [
      { value: '4', label: '4', badge: 'Stable' },
      { value: '5', label: '5', badge: 'Next' },
    ],
    defaultFrameworkVersion: '4',
    category: 'Node.js',
    desc: 'Minimalist & flexible Node.js web server',
    databaseEngine: 'postgres',
  },
  {
    id: 'django',
    name: 'Django',
    runtime: 'python',
    defaultVersion: '3.11',
    frameworkVersions: [
      { value: '5.1', label: '5.1', badge: 'Latest', minRuntime: '3.10' },
      { value: '4.2', label: '4.2', badge: 'LTS', minRuntime: '3.8' },
    ],
    defaultFrameworkVersion: '5.1',
    category: 'Python',
    desc: 'The web framework for perfectionists with deadlines',
    databaseEngine: 'postgres',
    cacheEngine: 'redis',
  },
  {
    id: 'gin',
    name: 'Gin',
    runtime: 'go',
    defaultVersion: '1.23',
    frameworkVersions: [
      { value: 'latest', label: 'Latest', badge: 'Fast HTTP' },
    ],
    defaultFrameworkVersion: 'latest',
    category: 'Go',
    desc: 'High-performance HTTP web framework for Go',
    databaseEngine: 'postgres',
  },
  {
    id: 'rails',
    name: 'Ruby on Rails',
    runtime: 'ruby',
    defaultVersion: '3.2',
    frameworkVersions: [
      { value: '8.0', label: '8.0', badge: 'Latest', minRuntime: '3.2' },
      { value: '7.2', label: '7.2', badge: 'Stable', minRuntime: '3.1' },
    ],
    defaultFrameworkVersion: '8.0',
    category: 'Ruby',
    desc: 'Full-stack framework for developer happiness',
    databaseEngine: 'postgres',
    cacheEngine: 'redis',
  },
];

export interface RuntimeCompatibilityResult {
  versions: string[];
  recommended: string;
  note?: string;
}

export const getCompatibleRuntimeVersions = (
  runtime: RuntimeType,
  framework: string,
  frameworkVersion: string,
  allAvailableVersions: string[],
): RuntimeCompatibilityResult => {
  const fw = (framework || '').toLowerCase();
  const fv = (frameworkVersion || '').toLowerCase();
  const fallback = allAvailableVersions[0] || '8.4';

  if (runtime === 'php') {
    if (fw.includes('laravel')) {
      if (fv.startsWith('13') || fw.includes('13')) {
        const allowed = ['8.4', '8.3'];
        const filtered = allAvailableVersions.filter((v) => allowed.includes(v));
        return {
          versions: filtered.length ? filtered : allowed,
          recommended: (allAvailableVersions.includes('8.4') ? '8.4' : filtered[0]) || '8.4',
          note: 'Laravel 13 membutuhkan PHP ≥ 8.3 (Direkomendasikan: PHP 8.4)',
        };
      }
      if (fv.startsWith('12') || fw.includes('12')) {
        const allowed = ['8.4', '8.3', '8.2'];
        const filtered = allAvailableVersions.filter((v) => allowed.includes(v));
        return {
          versions: filtered.length ? filtered : allowed,
          recommended: (allAvailableVersions.includes('8.4') ? '8.4' : filtered[0]) || '8.4',
          note: 'Laravel 12 membutuhkan PHP ≥ 8.2 (Direkomendasikan: PHP 8.4)',
        };
      }
      if (fv.startsWith('11') || fw.includes('11')) {
        const allowed = ['8.4', '8.3', '8.2'];
        const filtered = allAvailableVersions.filter((v) => allowed.includes(v));
        return {
          versions: filtered.length ? filtered : allowed,
          recommended: (allAvailableVersions.includes('8.3') ? '8.3' : filtered[0]) || '8.3',
          note: 'Laravel 11 membutuhkan PHP ≥ 8.2 (Direkomendasikan: PHP 8.3)',
        };
      }
      if (fv.startsWith('10') || fw.includes('10')) {
        const allowed = ['8.3', '8.2', '8.1'];
        const filtered = allAvailableVersions.filter((v) => allowed.includes(v));
        return {
          versions: filtered.length ? filtered : allowed,
          recommended: (allAvailableVersions.includes('8.2') ? '8.2' : filtered[0]) || '8.2',
          note: 'Laravel 10 membutuhkan PHP 8.1 - 8.3 (Direkomendasikan: PHP 8.2)',
        };
      }
    }

    if (fw.includes('symfony')) {
      if (fv.startsWith('8') || fw.includes('8')) {
        const allowed = ['8.4', '8.3'];
        const filtered = allAvailableVersions.filter((v) => allowed.includes(v));
        return {
          versions: filtered.length ? filtered : allowed,
          recommended: (allAvailableVersions.includes('8.4') ? '8.4' : filtered[0]) || '8.4',
          note: 'Symfony 8 membutuhkan PHP ≥ 8.3 (Direkomendasikan: PHP 8.4)',
        };
      }
      if (fv.startsWith('7') || fw.includes('7')) {
        const allowed = ['8.4', '8.3', '8.2'];
        const filtered = allAvailableVersions.filter((v) => allowed.includes(v));
        return {
          versions: filtered.length ? filtered : allowed,
          recommended: (allAvailableVersions.includes('8.3') ? '8.3' : filtered[0]) || '8.3',
          note: 'Symfony 7 membutuhkan PHP ≥ 8.2 (Direkomendasikan: PHP 8.3)',
        };
      }
      if (fv.startsWith('6') || fw.includes('6')) {
        const allowed = ['8.3', '8.2', '8.1'];
        const filtered = allAvailableVersions.filter((v) => allowed.includes(v));
        return {
          versions: filtered.length ? filtered : allowed,
          recommended: (allAvailableVersions.includes('8.2') ? '8.2' : filtered[0]) || '8.2',
          note: 'Symfony 6.4 membutuhkan PHP ≥ 8.1 (Direkomendasikan: PHP 8.2)',
        };
      }
    }

    if (fw.includes('drupal')) {
      if (fv.startsWith('11') || fw.includes('11')) {
        const allowed = ['8.4', '8.3'];
        const filtered = allAvailableVersions.filter((v) => allowed.includes(v));
        return {
          versions: filtered.length ? filtered : allowed,
          recommended: '8.3',
          note: 'Drupal 11 membutuhkan PHP ≥ 8.3',
        };
      }
    }

    if (fw.includes('woocommerce')) {
      const allowed = ['8.3', '8.2', '8.1'];
      const filtered = allAvailableVersions.filter((v) => allowed.includes(v));
      return {
        versions: filtered.length ? filtered : allowed,
        recommended: '8.3',
        note: 'WooCommerce direkomendasikan dengan PHP 8.1 - 8.3',
      };
    }
  }

  if (runtime === 'nodejs') {
    if (fw.includes('next')) {
      if (fv.startsWith('15') || fw.includes('15')) {
        const allowed = ['22', '20'];
        const filtered = allAvailableVersions.filter((v) => allowed.includes(v));
        return {
          versions: filtered.length ? filtered : allowed,
          recommended: (allAvailableVersions.includes('22') ? '22' : filtered[0]) || '22',
          note: 'Next.js 15 membutuhkan Node.js ≥ 18.18 (Direkomendasikan: Node 20 atau 22)',
        };
      }
      if (fv.startsWith('14') || fw.includes('14')) {
        const allowed = ['20', '18'];
        const filtered = allAvailableVersions.filter((v) => allowed.includes(v));
        return {
          versions: filtered.length ? filtered : allowed,
          recommended: '20',
          note: 'Next.js 14 mendukung Node.js 18 & 20',
        };
      }
    }
  }

  if (runtime === 'python') {
    if (fw.includes('django')) {
      if (fv.startsWith('5') || fw.includes('5')) {
        const allowed = ['3.12', '3.11', '3.10'];
        const filtered = allAvailableVersions.filter((v) => allowed.includes(v));
        return {
          versions: filtered.length ? filtered : allowed,
          recommended: (allAvailableVersions.includes('3.12') ? '3.12' : filtered[0]) || '3.12',
          note: 'Django 5.1 membutuhkan Python ≥ 3.10 (Direkomendasikan: Python 3.12)',
        };
      }
    }
  }

  if (runtime === 'ruby') {
    if (fw.includes('rails')) {
      if (fv.startsWith('8') || fw.includes('8')) {
        const allowed = ['3.3', '3.2'];
        const filtered = allAvailableVersions.filter((v) => allowed.includes(v));
        const finalVersions = filtered.length ? filtered : (allAvailableVersions.length ? allAvailableVersions : allowed);
        const rec = (finalVersions.includes('3.2') && !finalVersions.includes('3.3')) ? '3.2' : (finalVersions.includes('3.3') ? '3.3' : finalVersions[0]);
        return {
          versions: finalVersions,
          recommended: rec,
          note: 'Rails 8.0 membutuhkan Ruby ≥ 3.2',
        };
      }
      if (fv.startsWith('7') || fw.includes('7')) {
        const allowed = ['3.3', '3.2', '3.1'];
        const filtered = allAvailableVersions.filter((v) => allowed.includes(v));
        const finalVersions = filtered.length ? filtered : (allAvailableVersions.length ? allAvailableVersions : allowed);
        const rec = (finalVersions.includes('3.2') ? '3.2' : finalVersions[0]);
        return {
          versions: finalVersions,
          recommended: rec,
          note: 'Rails 7.2 membutuhkan Ruby ≥ 3.1',
        };
      }
    }
  }

  return { versions: allAvailableVersions, recommended: fallback };
};

export interface SupportedDbEngine {
  engine: DatabaseEngine;
  label?: string;
  badge?: string;
  warning?: string;
  recommended?: boolean;
}

export const getSupportedDbEngines = (runtime: RuntimeType, framework: string): SupportedDbEngine[] => {
  const fw = (framework || '').toLowerCase();

  // CMSs strictly requiring MySQL / MariaDB (or SQLite via drop-in)
  if (/wordpress|woocommerce|joomla|prestashop|drupal|whmcs|magento|shopware|moodle|nextcloud|owncloud/i.test(fw)) {
    return [
      { engine: 'mariadb', label: 'MariaDB / MySQL', recommended: true, badge: 'Standard CMS' },
      { engine: 'sqlite', label: 'SQLite', badge: 'Embedded' },
    ];
  }

  // PHP frameworks (Laravel, Symfony, CodeIgniter, CakePHP, Slim, etc.)
  if (runtime === 'php') {
    return [
      { engine: 'mariadb', label: 'MariaDB / MySQL', recommended: true, badge: 'Standard PHP' },
      { engine: 'postgres', label: 'PostgreSQL', badge: 'Relational' },
      { engine: 'sqlite', label: 'SQLite', badge: 'Embedded' },
    ];
  }

  // Node.js
  if (runtime === 'nodejs') {
    return [
      { engine: 'postgres', label: 'PostgreSQL', recommended: true, badge: 'Prisma / Drizzle' },
      { engine: 'mariadb', label: 'MariaDB / MySQL' },
      { engine: 'sqlite', label: 'SQLite' },
    ];
  }

  // Python
  if (runtime === 'python') {
    return [
      { engine: 'postgres', label: 'PostgreSQL', recommended: true, badge: 'SQLAlchemy / Django' },
      { engine: 'mariadb', label: 'MariaDB / MySQL' },
      { engine: 'sqlite', label: 'SQLite' },
    ];
  }

  // Go / Rust / Ruby / others
  return [
    { engine: 'postgres', label: 'PostgreSQL', recommended: true, badge: 'Recommended' },
    { engine: 'mariadb', label: 'MariaDB / MySQL' },
    { engine: 'sqlite', label: 'SQLite' },
  ];
};

export const supportsCacheFor = (runtime: RuntimeType, framework: string): boolean => {
  const fw = (framework || '').toLowerCase();

  // Static sites never use cache
  if (runtime === 'static' || /static|html|vite|astro/i.test(fw)) return false;

  // CMSs don't support Redis out of the box in their core installer
  if (/wordpress|woocommerce|joomla|prestashop|drupal|whmcs|magento|shopware|moodle|nextcloud|owncloud|matomo|mautic/i.test(fw)) {
    return false;
  }

  // Micro-frameworks or simple starters without built-in Redis env setup
  if (/codeigniter|cakephp|slim|laminas|yii/i.test(fw)) {
    return false;
  }

  // Compiled binary stacks (Go, Rust) starters don't use Redis
  if (runtime === 'go' || runtime === 'rust') {
    return false;
  }

  // Frameworks with native first-class Redis support in scaffold
  if (/laravel|symfony|django|rails/i.test(fw)) {
    return true;
  }

  // Generic custom apps where developer brings code
  if (/generic|custom/i.test(fw)) {
    return true;
  }

  // Node.js or Python backend apps (NestJS, Express, FastAPI)
  if (runtime === 'nodejs' || runtime === 'python' || runtime === 'ruby') {
    return true;
  }

  return false;
};

const stepsForMode = (
  mode: 'standard' | 'proxy' | 'static',
  runtime: RuntimeType,
  framework: string,
): { id: WizardStep; label: string }[] => {
  if (mode === 'proxy') {
    return [
      { id: 'basics', label: 'Basics' },
      { id: 'upstream', label: 'Upstream' },
      { id: 'review', label: 'Review' },
    ];
  }
  const isStatic = mode === 'static' || runtime === 'static' || /static|html|vite\s*dist|astro\s*static/i.test(framework);
  if (isStatic) {
    return [
      { id: 'basics', label: 'Basics' },
      { id: 'source', label: 'Source' },
      { id: 'engine', label: 'Engine' },
      { id: 'review', label: 'Review' },
    ];
  }
  const hasCache = supportsCacheFor(runtime, framework);
  return [
    { id: 'basics', label: 'Basics' },
    { id: 'source', label: 'Source (Auto-Detect)' },
    { id: 'engine', label: 'Engine & Runtime' },
    { id: 'database', label: hasCache ? 'Database & Cache' : 'Database' },
    { id: 'review', label: 'Review' },
  ];
};

const defaultPortFor = (runtime: RuntimeType): number =>
  runtime === 'php' ? 8001 : runtime === 'python' ? 5000 : runtime === 'nodejs' ? 3000 : runtime === 'static' ? 80 : 8080;

/** Accepts a bare FQDN like api.example.com (no scheme, no spaces, at least one dot). */
const isValidDomain = (value: string): boolean =>
  /^([a-z0-9](?:-*[a-z0-9])*)(?:\.([a-z0-9](?:-*[a-z0-9])*))+$/i.test(value);

export const AddAppModal: React.FC<AddAppModalProps> = ({
  isOpen,
  onClose,
  onAddApp,
  currentUsername,
  isAdmin = false,
  existingApps = [],
}) => {
  const defaultTenant = currentUsername || 'farras';
  const [appMode, setAppMode] = useState<'standard' | 'proxy' | 'static'>('standard');
  const [stepIndex, setStepIndex] = useState(0);

  // Basics
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [tenantUser, setTenantUser] = useState(defaultTenant);
  const [availableUsers, setAvailableUsers] = useState<Array<{ username: string; role: string; groupName?: string }>>([]);
  const [tunnelEnabled, setTunnelEnabled] = useState(true);

  // Real-time duplicate validation
  const normalizedSlug = useMemo(() => {
    return name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  }, [name]);

  const duplicateNameSite = useMemo(() => {
    if (!normalizedSlug || !existingApps.length) return null;
    return existingApps.find(
      (a) =>
        a.name.toLowerCase() === normalizedSlug ||
        a.id.toLowerCase() === normalizedSlug ||
        a.name.toLowerCase().trim() === name.toLowerCase().trim()
    );
  }, [normalizedSlug, name, existingApps]);

  const duplicateDomainSite = useMemo(() => {
    const clean = domain.trim().toLowerCase();
    if (!clean || !existingApps.length) return null;
    return existingApps.find((a) => a.domain.toLowerCase().trim() === clean);
  }, [domain, existingApps]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Engine & runtime
  const [webServer, setWebServer] = useState<WebServerType>('nginx');
  const [runtime, setRuntime] = useState<RuntimeType>('php');
  const [framework, setFramework] = useState('Laravel');
  const [frameworkVersion, setFrameworkVersion] = useState('12');
  const [version, setVersion] = useState('8.4');

  // Source
  const [sourceKind, setSourceKind] = useState<SourceKind>('scaffold');
  const [gitRepo, setGitRepo] = useState('');
  const [gitBranch, setGitBranch] = useState('main');
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [uploadFile, setUploadFile] = useState<string | null>(null);
  // The archive itself, not only its name: the deploy has to send these bytes (the name
  // used to be a validity gate and a Review label, and nothing was ever uploaded).
  const [uploadArchive, setUploadArchive] = useState<File | null>(null);
  const [detectedFw, setDetectedFw] = useState<DetectedFramework | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [dirCheck, setDirCheck] = useState<'idle' | 'checking' | 'ok' | 'created' | 'error'>('idle');
  const [dirPath, setDirPath] = useState<string | null>(null);
  const [dirError, setDirError] = useState('');
  const KNOWN_EXISTING_APPS = ['flask-sentiment-api', 'larastore-commerce', 'billing-backend-api', 'fastapi-ai-service', 'legacy-news-portal', 'internal-n8n-proxy'];
  const existingPath = `/home/${tenantUser}/web/${name || '<website>'}`;

  const applyDetectedFramework = (fw: DetectedFramework) => {
    setDetectedFw(fw);
    if (fw.runtime) {
      setRuntime(fw.runtime);
      if (fw.runtime === 'static') {
        setAppMode('static');
      } else {
        setAppMode('standard');
      }
    }
    if (fw.version) {
      setVersion(fw.version);
    }
    if (fw.title) {
      const match = fw.title.match(/(\d+(\.\d+)?)/);
      if (match) {
        setFramework(fw.title.replace(/\s*\d+(\.\d+)?/g, '').trim() || fw.title);
        setFrameworkVersion(match[1]);
      } else {
        setFramework(fw.title);
        setFrameworkVersion('latest');
      }
    }
    if (fw.databaseEngine) {
      setCreateDb(true);
      setDbType(fw.databaseEngine as DatabaseEngine);
    }
    if (fw.cacheEngine === 'redis') {
      setCreateCache(true);
    } else {
      setCreateCache(false);
    }
  };

  const handleArchiveSelect = async (file: File) => {
    setUploadArchive(file);
    setUploadFile(file.name);
    setIsDetecting(true);
    try {
      const res = await api.detectFrameworkFromArchive(file);
      if (res.ok && res.framework) {
        applyDetectedFramework(res.framework);
      }
    } catch {
      // ignore
    } finally {
      setIsDetecting(false);
    }
  };

  const checkExistingFramework = async (tenant: string, slug: string) => {
    setIsDetecting(true);
    try {
      const res = await api.detectFrameworkFromExisting(tenant, slug);
      if (res.ok && res.framework) {
        applyDetectedFramework(res.framework);
      }
    } catch {
      // ignore
    } finally {
      setIsDetecting(false);
    }
  };

  /**
   * Tenants have no shell on the server, so the panel creates the directory.
   * When the daemon is not running the prototype simulates the result.
   */
  const ensureDirectory = async () => {
    const slug = name.trim();
    if (!slug) return;
    setDirCheck('checking');
    setDirError('');
    try {
      if (!(await apiReachable())) {
        setDirPath(existingPath);
        setDirCheck(KNOWN_EXISTING_APPS.includes(slug) ? 'ok' : 'created');
        return;
      }
      const result = await api.prepareDirectory({ slug, tenantUser });
      setDirPath(result.path);
      setDirCheck(result.existed ? 'ok' : 'created');
      if (result.existed) {
        void checkExistingFramework(tenantUser, slug);
      }
    } catch (err) {
      const message = err instanceof ApiError ? (err.fields?.slug ?? err.message) : 'Could not reach the daemon';
      setDirError(message);
      setDirCheck('error');
    }
  };

  // Database
  const [createDb, setCreateDb] = useState(true);
  const [dbType, setDbType] = useState<DatabaseEngine>('mariadb');
  const [dbVersionIndex, setDbVersionIndex] = useState(0);
  const [dbName, setDbName] = useState('');
  const [dbUser, setDbUser] = useState('');
  const [dbPassword, setDbPassword] = useState('bp_' + Math.random().toString(36).slice(2, 12));
  const [showDbPassword, setShowDbPassword] = useState(false);
  const [maxConnections, setMaxConnections] = useState(25);
  const [createCache, setCreateCache] = useState(true);
  const [cacheVersionIndex, setCacheVersionIndex] = useState(0);
  const [cachePassword, setCachePassword] = useState('bp_' + Math.random().toString(36).slice(2, 12));
  const [showCachePassword, setShowCachePassword] = useState(false);
  const [autoEnv, setAutoEnv] = useState(true);

  // Proxy
  const [upstreamUrl, setUpstreamUrl] = useState('http://127.0.0.1:8080');
  const [proxyWebsocket, setProxyWebsocket] = useState(true);
  const [proxyPreserveHost, setProxyPreserveHost] = useState(true);
  const [proxyRealIp, setProxyRealIp] = useState(true);
  const [proxyTimeoutSecs, setProxyTimeoutSecs] = useState(60);
  const [clientMaxBodyMB] = useState(100);

  const [copiedConfig, setCopiedConfig] = useState(false);
  const [stackStatus, setStackStatus] = useState<StackStatus | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTenantUser(currentUsername || 'farras');
    void (async () => {
      try {
        if (await apiReachable()) {
          const s = await api.stack();
          setStackStatus(s);
          if (isAdmin) {
            try {
              const u = await api.users();
              if (u.items && u.items.length > 0) {
                setAvailableUsers(u.items.map((it) => ({ username: it.username, role: it.role, groupName: it.groupName })));
              }
            } catch {
              setAvailableUsers([{ username: currentUsername || 'farras', role: 'admin' }]);
            }
          } else {
            setAvailableUsers([{ username: currentUsername || 'user', role: 'user' }]);
          }
        }
      } catch {
        // simulation or offline mode fallback
        setAvailableUsers([{ username: currentUsername || 'farras', role: 'admin' }]);
      }
    })();
  }, [isOpen, currentUsername, isAdmin]);

  const runtimeConfigs: Record<RuntimeType, { versions: string[]; frameworks: string[] }> = useMemo(() => {
    const getVersions = (name: string, fallback: string[]) => {
      const rt = stackStatus?.runtimes?.[name];
      if (rt) {
        if (rt.installed && rt.installed.length > 0) return rt.installed;
        if (rt.available && rt.available.length > 0) return rt.supported?.length ? rt.supported : rt.available;
      }
      return fallback;
    };

    return {
      php: {
        versions: getVersions('php', ['8.4', '8.3', '8.2', '8.1', '8.0', '7.4']),
        frameworks: [
          'Generic (bring your own code)',
          'Laravel 13',
          'Laravel 12',
          'Symfony 8',
          'Symfony 7',
          'CodeIgniter 4',
          'CakePHP 5',
          'Slim 4',
          'Laminas',
          'Yii 2',
          'WordPress',
          'WooCommerce',
          'Drupal 11',
          'Drupal 10',
          'Joomla 6',
          'Contao 4',
          'Neos 9',
          'TYPO3 14',
          'Nextcloud 34',
          'OwnCloud 12',
          'Moodle 5',
          'Matomo 5',
          'Mautic 7',
          'Magento 2',
          'PrestaShop 1.7',
          'Shopware 6',
          'WHMCS',
        ],
      },
      python: {
        versions: getVersions('python', ['3.12', '3.11', '3.10']),
        frameworks: ['Flask', 'FastAPI', 'Django', 'Generic (bring your own code)'],
      },
      nodejs: {
        versions: getVersions('node', ['22', '20', '18']),
        frameworks: ['Next.js', 'Nuxt', 'Astro', 'Express', 'NestJS', 'Generic (bring your own code)'],
      },
      go: { versions: getVersions('go', ['1.23', '1.22']), frameworks: ['Gin', 'Fiber', 'Standard HTTP', 'Generic (bring your own code)'] },
      rust: { versions: getVersions('rust', ['stable', 'beta']), frameworks: ['Axum', 'Actix-web', 'Generic (bring your own code)'] },
      ruby: { versions: getVersions('ruby', ['3.3', '3.2']), frameworks: ['Ruby on Rails', 'Sinatra', 'Generic (bring your own code)'] },
      docker: { versions: ['Latest'], frameworks: ['Custom Containerfile'] },
      static: { versions: ['HTML5'], frameworks: ['Static Web App', 'Vite Dist', 'Astro Static'] },
      proxy: { versions: ['v1.0'], frameworks: ['Reverse Proxy Forwarder'] },
    };
  }, [stackStatus]);


  const isStaticSite = appMode === 'static' || runtime === 'static' || /static|html|vite\s*dist|astro\s*static/i.test(framework);
  const steps = stepsForMode(appMode, runtime, framework);
  const currentStep = steps[Math.min(stepIndex, steps.length - 1)];
  const currentStepId = currentStep?.id ?? 'basics';

  const supportedDbEngines = useMemo(
    () => getSupportedDbEngines(runtime, framework),
    [runtime, framework],
  );
  const selectedEngineMeta = supportedDbEngines.find((e) => e.engine === dbType);

  const hasCacheSupport = supportsCacheFor(runtime, framework);
  const effectiveCreateCache = hasCacheSupport && createCache;

  useEffect(() => {
    if (!hasCacheSupport) {
      setCreateCache(false);
    }
  }, [hasCacheSupport]);

  useEffect(() => {
    if (!supportedDbEngines.some((e) => e.engine === dbType)) {
      const fallback = supportedDbEngines.find((e) => e.recommended)?.engine ?? supportedDbEngines[0]?.engine ?? 'mariadb';
      setDbType(fallback);
      setDbVersionIndex(0);
    }
  }, [supportedDbEngines, dbType]);

  // Only templates with an automated download are offered (plus the Generic option)
  const availableFrameworks = useMemo(() => {
    const list = runtimeConfigs[runtime].frameworks.filter(
      (fw) => /generic|custom/i.test(fw) || getProvisionPlan(runtime, fw).mode === 'download',
    );
    return list.length ? list : ['Generic (bring your own code)'];
  }, [runtime, runtimeConfigs]);

  const dbVersions = AVAILABLE_ENGINE_VERSIONS[dbType] ?? [];
  const activeDbVersion = dbVersions[Math.min(dbVersionIndex, dbVersions.length - 1)];
  const isSqlite = dbType === 'sqlite';

  const cacheVersions = AVAILABLE_ENGINE_VERSIONS.redis;
  const activeCacheVersion = cacheVersions[Math.min(cacheVersionIndex, cacheVersions.length - 1)];
  const resolvedDbName = dbName || `${name || 'website'}_db`;
  const resolvedDbUser = dbUser || `${tenantUser}_user`;

  const plan = getProvisionPlan(runtime, framework, frameworkVersion);
  const isGenericFramework = /generic|custom/i.test(framework);
  const effectiveSource: SourceKind = appMode === 'static' && sourceKind === 'scaffold' ? 'upload' : sourceKind;
  const domainValid = isValidDomain(domain.trim());

  const activeScaffold = useMemo(() => {
    return POPULAR_SCAFFOLDS.find(
      (s) =>
        s.name.toLowerCase() === framework.toLowerCase() ||
        s.name.toLowerCase() === (detectedFw?.title || '').toLowerCase()
    );
  }, [framework, detectedFw]);

  const rawAvailableVersions = useMemo(() => {
    return runtimeConfigs[runtime]?.versions ?? [];
  }, [runtime, runtimeConfigs]);

  const compatibleRuntimes = useMemo(() => {
    return getCompatibleRuntimeVersions(runtime, framework, frameworkVersion, rawAvailableVersions);
  }, [runtime, framework, frameworkVersion, rawAvailableVersions]);

  useEffect(() => {
    if (compatibleRuntimes.versions.length > 0 && !compatibleRuntimes.versions.includes(version)) {
      setVersion(compatibleRuntimes.recommended);
    }
  }, [compatibleRuntimes, version]);

  // Keep the selected template inside the available list if current framework isn't custom
  useEffect(() => {
    if (!availableFrameworks.includes(framework) && !POPULAR_SCAFFOLDS.some(s => s.name === framework)) {
      setFramework(availableFrameworks[0]);
    }
  }, [availableFrameworks, framework]);

  const handleSelectScaffold = (s: ScaffoldPreset) => {
    setFramework(s.name);
    setRuntime(s.runtime);
    const defaultFwVer = s.defaultFrameworkVersion ?? s.frameworkVersions?.[0]?.value ?? 'latest';
    setFrameworkVersion(defaultFwVer);
    const comp = getCompatibleRuntimeVersions(s.runtime, s.name, defaultFwVer, runtimeConfigs[s.runtime]?.versions ?? []);
    setVersion(comp.recommended);
    if (s.databaseEngine) {
      setCreateDb(true);
      setDbType(s.databaseEngine);
    }
    if (s.cacheEngine === 'redis') {
      setCreateCache(true);
    } else {
      setCreateCache(false);
    }
  };

  const expectedRuntime = detectedFw?.runtime;
  const isRuntimeMismatch = Boolean(expectedRuntime && expectedRuntime !== runtime);

  const sourceValid =
    effectiveSource === 'scaffold'
      ? (framework.trim() !== '' && !isGenericFramework)
      : effectiveSource === 'github'
        ? gitRepo.trim() !== ''
        : effectiveSource === 'upload'
          ? uploadFile !== null
          : effectiveSource === 'default'
            ? true // nothing to provide: the daemon writes the page itself
            : dirCheck === 'ok';

  // "Default page" means there is no application yet, so the site is a directory the web
  // server serves — choosing it also settles the runtime, which otherwise would be asked
  // to start something that does not exist.
  const handleSourceKind = (kind: SourceKind) => {
    setSourceKind(kind);
    if (kind !== 'default') return;
    setRuntime('static');
    setVersion('HTML5');
    setFramework('Static Web App');
    setWebServer('nginx');
    setCreateDb(false);
    setCreateCache(false);
  };

  const sourceValidForMode = appMode === 'proxy' ? true : sourceValid;

  const handleModeSwitch = (mode: 'standard' | 'proxy' | 'static') => {
    setAppMode(mode);
    setStepIndex(0);
    if (mode === 'proxy') {
      setRuntime('proxy');
      setVersion('v1.0');
      setWebServer('nginx');
      setCreateDb(false);
      setCreateCache(false);
    } else if (mode === 'static') {
      setRuntime('static');
      setVersion('HTML5');
      setFramework('Static Web App');
      setWebServer('nginx');
      setCreateDb(false);
      setCreateCache(false);
    } else {
      setRuntime('php');
      setVersion('8.4');
      setFramework('Laravel 12');
      setWebServer('nginx');
      setCreateDb(true);
      setCreateCache(true);
    }
  };

  const handleRuntimeChange = (next: RuntimeType) => {
    setRuntime(next);
    const cfg = runtimeConfigs[next];
    setVersion(cfg.versions[0] || 'latest');
    setFramework(cfg.frameworks[0] || 'Generic (bring your own code)');
    // Preserve user webServer selection
  };

  const envPreview = useMemo(() => {
    const lines: string[] = ['APP_ENV=production', `APP_URL=https://${domain || 'example.com'}`];

    if (createDb) {
      lines.push('');
      if (isSqlite) {
        lines.push('# Database — SQLite (file-based, no daemon)');
        lines.push('DB_CONNECTION=sqlite');
        lines.push(`DB_DATABASE=/home/${tenantUser}/web/${name || 'website'}/${resolvedDbName}.sqlite`);
      } else {
        const host = '127.0.0.1';
        const port = activeDbVersion?.port ?? 0;
        if (dbType === 'postgres') {
          lines.push('# Database — PostgreSQL');
          lines.push('DB_CONNECTION=pgsql');
        } else if (dbType === 'mysql' || dbType === 'mariadb') {
          lines.push('# Database — MySQL / MariaDB');
          lines.push('DB_CONNECTION=mysql');
        } else {
          lines.push('# Database — MongoDB');
          lines.push(`MONGODB_URI="mongodb://${resolvedDbUser}:${dbPassword}@${host}:${port}/${resolvedDbName}?authSource=admin"`);
          lines.push(`MONGO_INITDB_DATABASE=${resolvedDbName}`);
        }
        if (dbType !== 'mongodb') {
          lines.push(`DB_HOST=${host}`);
          lines.push(`DB_PORT=${port}`);
          lines.push(`DB_DATABASE=${resolvedDbName}`);
          lines.push(`DB_USERNAME=${resolvedDbUser}`);
          lines.push(`DB_PASSWORD=${dbPassword}`);
        }
      }
    }

    if (effectiveCreateCache) {
      lines.push('');
      lines.push('# Cache — Redis');
      lines.push('CACHE_STORE=redis');
      lines.push(`REDIS_HOST=127.0.0.1`);
      lines.push(`REDIS_PORT=${activeCacheVersion?.port ?? 6379}`);
      lines.push(`REDIS_PASSWORD=${cachePassword}`);
    }

    return lines.join('\n');
  }, [createDb, effectiveCreateCache, dbType, resolvedDbName, resolvedDbUser, dbPassword, cachePassword, domain, name, tenantUser, isSqlite, activeDbVersion, activeCacheVersion]);

  const getGeneratedConfig = () => {
    const dName = domain || 'example.com';
    const upTarget = appMode === 'proxy' ? upstreamUrl || 'http://127.0.0.1:8080' : `http://127.0.0.1:${defaultPortFor(runtime)}`;

    if (webServer === 'caddy') {
      return `${dName} {
    tls {
        issuer lets_encrypt
    }
    reverse_proxy ${upTarget.replace(/^https?:\/\//, '')} {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}`;
    }

    if (webServer === 'openlitespeed') {
      return `extprocessor ${name || 'website'}_proxy {
    type proxy
    address ${upTarget.replace(/^https?:\/\//, '')}
    maxConns 200
    initTimeout 60
    retryTimeout 0
}

context / {
    type proxy
    handler ${name || 'website'}_proxy
    addDefaultCharset off
}`;
    }

    if (webServer === 'apache') {
      const cleanUp = upTarget.replace(/^https?:\/\//, '');
      return `<VirtualHost *:80 *:443>
    ServerName ${dName}
    ProxyPreserveHost ${proxyPreserveHost ? 'On' : 'Off'}
    ProxyRequests Off
    Timeout ${proxyTimeoutSecs}

    <Location />
${proxyWebsocket ? `        RewriteEngine On
        RewriteCond %{HTTP:Upgrade} websocket [NC]
        RewriteCond %{HTTP:Connection} upgrade [NC]
        RewriteRule ^/?(.*) "ws://${cleanUp}/$1" [P,L]
` : ''}        ProxyPass ${upTarget}/
        ProxyPassReverse ${upTarget}/
    </Location>
</VirtualHost>`;
    }

    return `server {
    listen 80;
    listen 443 ssl http2;
    server_name ${dName};

    ssl_certificate /etc/letsencrypt/live/${dName}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${dName}/privkey.pem;

    client_max_body_size ${clientMaxBodyMB}M;

    location / {
        proxy_pass ${upTarget};
        proxy_http_version 1.1;
${proxyWebsocket ? '        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection "upgrade";\n' : ''}${proxyPreserveHost ? '        proxy_set_header Host $host;\n' : ''}${proxyRealIp ? '        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n' : ''}        proxy_read_timeout ${proxyTimeoutSecs}s;
    }
}`;
  };

  if (!isOpen) return null;

  const canContinue =
    (currentStepId !== 'basics' ||
      (name.trim() !== '' && domainValid && !duplicateNameSite && !duplicateDomainSite)) &&
    (currentStepId !== 'source' || sourceValidForMode);

  const next = () => setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  const back = () => setStepIndex((i) => Math.max(i - 1, 0));

  const handleDeploy = async () => {
    const resolvedPort = appMode === 'proxy'
      ? Number((upstreamUrl.match(/:(\d+)/) || [])[1] || 8080)
      : defaultPortFor(runtime);

    const buildScript =
      detectedFw?.buildCommand
        ? detectedFw.buildCommand
        : effectiveSource === 'github'
          ? `git pull origin ${gitBranch || 'main'}\n${plan.steps.join('\n')}`
          : plan.steps.join('\n');

    const extraEnvMap: Record<string, string> = {};
    if (autoEnv && envPreview) {
      envPreview.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const idx = trimmed.indexOf('=');
        if (idx !== -1) {
          const k = trimmed.slice(0, idx).trim();
          let v = trimmed.slice(idx + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          if (k) extraEnvMap[k] = v;
        }
      });
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onAddApp({
        name,
        domain,
        runtime,
        version,
        framework,
        frameworkVersion: frameworkVersion || undefined,
        webServer,
        tenantUser,
        tunnelEnabled,
        ssl: true,
        port: resolvedPort,
        memoryUsage: '36 MB',
        cpuUsage: '0.1%',
        status: 'running',
        upstreamUrl: appMode === 'proxy' ? upstreamUrl : undefined,
        proxyWebsocket,
        proxyPreserveHost,
        proxyRealIp,
        proxyTimeoutSecs,
        dbAutoProvision: !isStaticSite && createDb,
        dbEngine: (!isStaticSite && createDb) ? dbType : undefined,
        dbName: (!isStaticSite && createDb) ? resolvedDbName : undefined,
        dbUser: (!isStaticSite && createDb) ? resolvedDbUser : undefined,
        cacheAutoProvision: !isStaticSite && effectiveCreateCache,
        cacheEngine: (!isStaticSite && effectiveCreateCache) ? 'redis' : undefined,
        autoEnv: isStaticSite ? false : autoEnv,
        env: Object.keys(extraEnvMap).length > 0 ? extraEnvMap : undefined,
        sourceKind: effectiveSource,
        provisionMode: effectiveSource === 'scaffold' ? 'download' : 'generic',
        automationSteps: plan.steps.length ? plan.steps : undefined,
        gitRepo: effectiveSource === 'github' ? gitRepo : undefined,
        gitBranch: effectiveSource === 'github' ? gitBranch : undefined,
        autoDeploy: effectiveSource === 'github' ? autoDeploy : undefined,
        buildScript: buildScript || undefined,
      }, effectiveSource === 'upload' ? (uploadArchive ?? undefined) : undefined);

      onClose();
      resetForm();
    } catch (err: any) {
      setSubmitError(err instanceof Error ? err.message : 'Penerapan website ditolak oleh server.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setStepIndex(0);
    setName('');
    setDomain('');
    setSubmitError(null);
  };

  const inputClass =
    'w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500';
  const cardChoice = (active: boolean) =>
    active ? 'border-blue-600 bg-blue-50/80 text-blue-900 ring-2 ring-blue-500/15' : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Deploy New Website</h2>
              <p className="text-xs text-slate-500">Guided setup — engine, runtime, source, database and automation.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stepper */}
        <div className="px-6 py-3 border-b border-slate-100 flex items-center gap-1.5 overflow-x-auto shrink-0">
          {steps.map((s, i) => {
            const state = i === stepIndex ? 'active' : i < stepIndex ? 'done' : 'todo';
            return (
              <button
                key={s.id}
                onClick={() => i <= stepIndex && setStepIndex(i)}
                disabled={i > stepIndex}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  state === 'active'
                    ? 'bg-blue-600 text-white'
                    : state === 'done'
                      ? 'bg-blue-50 text-blue-700 cursor-pointer'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${state === 'active' ? 'bg-white/20' : state === 'done' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                  {state === 'done' ? '✓' : i + 1}
                </span>
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {submitError && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-start gap-2.5 text-xs animate-in fade-in">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <span className="font-bold block">Penerapan Website Ditolak Server:</span>
                <p className="mt-0.5 text-rose-700 leading-relaxed">{submitError}</p>
              </div>
              <button
                type="button"
                onClick={() => setSubmitError(null)}
                className="text-rose-400 hover:text-rose-600 font-bold px-1.5 text-sm"
              >
                ✕
              </button>
            </div>
          )}

          {detectedFw && (
            <div className="p-3.5 bg-gradient-to-r from-purple-500/10 via-indigo-500/10 to-emerald-500/10 border border-purple-500/30 rounded-xl flex items-start gap-3">
              <div className="p-2 bg-purple-500/20 text-purple-600 rounded-lg shrink-0 mt-0.5">
                <Zap className="w-4 h-4 text-purple-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-900">Project Auto-Detected: {detectedFw.title}</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 bg-purple-100 text-purple-800 rounded-full border border-purple-200 font-semibold">
                    Vercel-Style Auto-Preset
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                  Runtime set to <span className="text-indigo-700 font-semibold">{detectedFw.runtime.toUpperCase()} {detectedFw.version || ''}</span>
                  {detectedFw.docRoot && <>, Web Root <span className="text-emerald-700 font-mono font-semibold">/{detectedFw.docRoot}</span></>}
                  {detectedFw.databaseEngine && <>, Database <span className="text-amber-700 font-semibold">{detectedFw.databaseEngine.toUpperCase()}</span></>}.
                  {detectedFw.buildCommand && (
                    <span className="block text-[11px] text-slate-500 font-mono mt-1 bg-slate-100 p-1.5 rounded truncate">
                      Build: {detectedFw.buildCommand}
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetectedFw(null)}
                className="text-[11px] text-slate-400 hover:text-slate-600 font-medium px-2 py-1"
              >
                Clear
              </button>
            </div>
          )}

          {/* STEP: BASICS */}
          {currentStepId === 'basics' && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'standard' as const, label: 'Full Web App', sub: 'PHP · Python · Node', icon: Zap },
                  { id: 'proxy' as const, label: 'Reverse Proxy', sub: 'Forward port / IP', icon: ArrowRightLeft },
                  { id: 'static' as const, label: 'Static / SPA', sub: 'HTML · Vite · Astro', icon: Globe },
                ].map((mode) => {
                  const Icon = mode.icon;
                  const active = appMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => handleModeSwitch(mode.id)}
                      className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border text-center transition-all ${cardChoice(active)}`}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="text-[11px] font-bold leading-tight">{mode.label}</span>
                      <span className="text-[10px] text-slate-400 leading-tight">{mode.sub}</span>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Website Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. larastore-commerce"
                    className={`${inputClass} ${
                      duplicateNameSite ? 'border-rose-400 focus:border-rose-500 bg-rose-50/40 text-rose-900' : ''
                    }`}
                  />
                  {duplicateNameSite ? (
                    <p className="text-[11px] font-medium text-rose-600 mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Nama / slug "{normalizedSlug}" sudah digunakan oleh website "{duplicateNameSite.name}".
                    </p>
                  ) : name.trim() !== '' ? (
                    <p className="text-[11px] text-slate-400 mt-1">
                      Slug: <code className="font-mono text-slate-600">{normalizedSlug}</code>
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Domain (FQDN)</label>
                  <input
                    type="text"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="app.example.com"
                    className={`${inputClass} ${
                      duplicateDomainSite || (domain.trim() !== '' && !domainValid)
                        ? 'border-rose-400 focus:border-rose-500 bg-rose-50/40 text-rose-900'
                        : ''
                    }`}
                  />
                  {duplicateDomainSite ? (
                    <p className="text-[11px] font-medium text-rose-600 mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Domain "{domain.trim()}" sudah digunakan oleh website "{duplicateDomainSite.name}".
                    </p>
                  ) : domain.trim() !== '' && !domainValid ? (
                    <p className="text-[11px] text-rose-600 mt-1">
                      Masukkan domain FQDN yang valid tanpa skema, contoh: <code className="font-mono">app.example.com</code>
                    </p>
                  ) : name.trim() !== '' && domain.trim() !== '' && name.trim().toLowerCase() === domain.trim().toLowerCase() ? (
                    <p className="text-[10px] text-slate-400 mt-1">
                      Info: Nama website akan menggunakan slug <code className="font-mono">{normalizedSlug}</code>.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Website Owner {isAdmin ? '(Assign to User)' : ''}
                  </label>
                  {isAdmin ? (
                    <select
                      value={tenantUser}
                      onChange={(e) => setTenantUser(e.target.value)}
                      className={inputClass}
                    >
                      {availableUsers.length > 0 ? (
                        availableUsers.map((u) => (
                          <option key={u.username} value={u.username}>
                            {u.username} ({u.role === 'admin' ? 'Administrator' : u.groupName || 'User'}{u.username === currentUsername ? ' — You' : ''})
                          </option>
                        ))
                      ) : (
                        <option value={defaultTenant}>{defaultTenant} (You)</option>
                      )}
                    </select>
                  ) : (
                    <div className="px-3 py-2 text-xs font-mono bg-slate-50 text-slate-800 rounded-lg border border-slate-200 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-semibold">{tenantUser}</span>
                      </div>
                      <span className="text-[10px] font-sans font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                        Your Account
                      </span>
                    </div>
                  )}
                  <p className="text-[11px] text-slate-400 mt-1">
                    Path: <code className="font-mono text-slate-500">/home/{tenantUser}/web/{name || '<website>'}</code>
                  </p>
                </div>
                <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer">
                  <input type="checkbox" checked={tunnelEnabled} onChange={(e) => setTunnelEnabled(e.target.checked)} className="mt-0.5 rounded border-slate-300 text-blue-600" />
                  <span className="text-xs">
                    <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <CloudRain className="w-3.5 h-3.5 text-blue-500" /> Cloudflare Tunnel (Zero-NAT)
                    </span>
                    <span className="text-slate-500 block mt-0.5">Publish the domain without a public IP or port forwarding.</span>
                  </span>
                </label>
              </div>
            </>
          )}

          {/* STEP: SOURCE */}
          {currentStepId === 'source' && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {[
                  ...(appMode === 'standard'
                    ? [{ id: 'scaffold' as SourceKind, label: 'Scaffold Template', icon: Download }]
                    : []),
                  { id: 'upload' as SourceKind, label: 'Upload Archive', icon: Upload },
                  { id: 'github' as SourceKind, label: 'GitHub Repository', icon: GitBranch },
                  { id: 'existing' as SourceKind, label: 'Existing Files', icon: FolderOpen },
                  { id: 'default' as SourceKind, label: 'Default Page', icon: Globe },
                ].map((opt) => {
                  const Icon = opt.icon;
                  const active = effectiveSource === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSourceKind(opt.id)}
                      className={`flex flex-col items-start gap-1.5 p-3 rounded-xl border transition-all ${cardChoice(active)}`}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="text-[11px] font-bold leading-tight">{opt.label}</span>
                    </button>
                  );
                })}
              </div>

              {effectiveSource === 'scaffold' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-slate-700">Choose Starter Template</label>
                    <span className="text-[10px] text-slate-400">Pre-configures runtime, web server &amp; database</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                    {POPULAR_SCAFFOLDS.map((s) => {
                      const isSelected = framework === s.name;
                      const SIcon = runtimeIcon[s.runtime] ?? Code2;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => handleSelectScaffold(s)}
                          className={`p-2.5 rounded-xl border text-left flex items-start gap-2.5 transition-all ${
                            isSelected
                              ? 'border-blue-600 bg-blue-50/80 ring-2 ring-blue-500/15'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                            <SIcon className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-xs font-bold text-slate-900 truncate">{s.name}</span>
                              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 uppercase">
                                {s.category}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-500 line-clamp-1 mt-0.5">{s.desc}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {activeScaffold?.frameworkVersions && activeScaffold.frameworkVersions.length > 1 && (
                    <div className="p-3 rounded-xl border border-blue-200 bg-white space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800">Pilih Versi {framework}:</span>
                        {compatibleRuntimes.note && (
                          <span className="text-[10px] text-blue-700 bg-blue-50 px-2 py-0.5 rounded font-medium flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 text-blue-600" />
                            {compatibleRuntimes.note}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {activeScaffold.frameworkVersions.map((fv) => {
                          const isVerSelected = frameworkVersion === fv.value;
                          return (
                            <button
                              key={fv.value}
                              type="button"
                              onClick={() => {
                                setFrameworkVersion(fv.value);
                                const comp = getCompatibleRuntimeVersions(runtime, framework, fv.value, rawAvailableVersions);
                                setVersion(comp.recommended);
                              }}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                                isVerSelected
                                  ? 'bg-blue-600 text-white shadow-xs'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                              }`}
                            >
                              <span>v{fv.label}</span>
                              {fv.badge && (
                                <span className={`text-[9px] px-1 py-0.2 rounded font-bold uppercase ${isVerSelected ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'}`}>
                                  {fv.badge}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="p-3 rounded-xl border border-blue-200 bg-blue-50/50 text-xs text-blue-900 flex items-center justify-between">
                    <div>
                      <span className="font-semibold">Selected: {framework} {frameworkVersion ? `v${frameworkVersion}` : ''} ({runtime.toUpperCase()} {version})</span>
                      <p className="text-[11px] text-blue-700 mt-0.5">
                        Target directory: <code className="font-mono">/home/{tenantUser}/web/{name || '<website>'}</code>
                      </p>
                    </div>
                    {plan.install && (
                      <span className="text-[10px] font-mono px-2 py-1 bg-white rounded border border-blue-200 text-blue-800">
                        {plan.install}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {effectiveSource === 'upload' && (
                <div className="p-5 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 text-center space-y-2">
                  <Upload className="w-6 h-6 text-slate-400 mx-auto" />
                  <p className="text-xs text-slate-600">Drop a <code className="font-mono">.zip</code> / <code className="font-mono">.tar.gz</code> archive (or upload it later in File Manager).</p>
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer shadow-xs">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{isDetecting ? 'Analyzing archive…' : (uploadFile ? uploadFile : 'Choose archive')}</span>
                    <input
                      type="file"
                      accept=".zip,.tar,.gz,.tgz"
                      className="hidden"
                      onChange={(e) => {
                        const picked = e.target.files?.[0] ?? null;
                        if (picked) {
                          void handleArchiveSelect(picked);
                        } else {
                          setUploadArchive(null);
                          setUploadFile(null);
                        }
                      }}
                    />
                  </label>
                  <p className="text-[10px] text-slate-400">
                    The archive is automatically analyzed to detect runtime &amp; framework presets.
                  </p>
                </div>
              )}

              {effectiveSource === 'github' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Repository URL</label>
                    <input type="text" value={gitRepo} onChange={(e) => setGitRepo(e.target.value)} placeholder="https://github.com/user/repo" className={inputClass} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Branch</label>
                      <input type="text" value={gitBranch} onChange={(e) => setGitBranch(e.target.value)} className={inputClass} />
                    </div>
                    <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer text-xs">
                      <input type="checkbox" checked={autoDeploy} onChange={(e) => setAutoDeploy(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
                      <span className="font-semibold text-slate-700">Auto-deploy on push (webhook)</span>
                    </label>
                  </div>
                </div>
              )}

              {effectiveSource === 'existing' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Site directory</label>
                    <div className="flex items-center gap-2">
                      <input type="text" value={dirPath ?? existingPath} readOnly className={`${inputClass} font-mono text-slate-500`} />
                      <button
                        type="button"
                        onClick={ensureDirectory}
                        disabled={dirCheck === 'checking' || !name.trim()}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg whitespace-nowrap disabled:opacity-40"
                      >
                        {dirCheck === 'checking'
                          ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          : <FolderPlus className="w-3.5 h-3.5" />}
                        <span>{dirCheck === 'checking' ? 'Working…' : 'Create directory'}</span>
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      There is no shell access on the server — the panel creates the folder with the correct ownership.
                    </p>
                  </div>

                  {dirCheck === 'ok' && (
                    <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-xs text-emerald-800 flex items-start gap-2">
                      <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span>Directory already exists. Upload your code with the File Manager, then deploy.</span>
                    </div>
                  )}

                  {dirCheck === 'created' && (
                    <div className="p-3 rounded-xl border border-sky-200 bg-sky-50 text-xs text-sky-800 flex items-start gap-2">
                      <Check className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                      <span>Directory created. Next: upload your code with the File Manager, then continue.</span>
                    </div>
                  )}

                  {dirCheck === 'error' && (
                    <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-800 flex items-start gap-2">
                      <X className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <span>{dirError || 'Could not create the directory.'}</span>
                    </div>
                  )}

                  {dirCheck === 'idle' && (
                    <p className="text-[11px] text-slate-400">
                      Create the directory first — the deploy cannot continue while it is missing or empty.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {/* STEP: ENGINE & RUNTIME */}
          {currentStepId === 'engine' && (
            <>
              {/* Mismatch Warning or Detected Status */}
              {isRuntimeMismatch && detectedFw && (
                <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-3 animate-in fade-in">
                  <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                  <div className="flex-1 text-xs">
                    <span className="font-bold text-amber-900 flex items-center gap-1.5">
                      Peringatan: Runtime Mismatch Terdeteksi
                    </span>
                    <p className="text-amber-800 mt-1 leading-relaxed">
                      Sumber kode Anda terdeteksi sebagai <strong>{detectedFw.title} ({expectedRuntime?.toUpperCase()})</strong>, namun Anda memilih runtime <strong>{runtime.toUpperCase()}</strong>.
                      Aplikasi kemungkinan besar tidak akan dapat dijalankan atau gagal build karena runtime tidak cocok dengan kode sumber.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        if (detectedFw.runtime) {
                          handleRuntimeChange(detectedFw.runtime);
                          applyDetectedFramework(detectedFw);
                        }
                      }}
                      className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors shadow-xs"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Kembalikan ke {expectedRuntime?.toUpperCase()} ({detectedFw.title})
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">Web Server Engine</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'nginx' as WebServerType, label: 'Nginx', desc: 'High Concurrency', badge: 'Standard' },
                    { id: 'openlitespeed' as WebServerType, label: 'OpenLiteSpeed', desc: runtime === 'php' ? 'LSAPI + LSCache' : 'High Speed HTTP/3', badge: runtime === 'php' ? 'Recommended' : undefined },
                    { id: 'caddy' as WebServerType, label: 'Caddy', desc: 'Auto-HTTPS & HTTP/3', badge: 'Auto SSL' },
                    { id: 'apache' as WebServerType, label: 'Apache 2.4', desc: '.htaccess & MPM', badge: runtime === 'php' ? '.htaccess' : undefined },
                  ].map((ws) => {
                    const isInstalled = stackStatus?.webServer?.installed?.some((s) => s.engine === ws.id) ||
                                        stackStatus?.webServer?.managedInstalled?.some((s) => s.engine === ws.id) ||
                                        ws.id === 'nginx';
                    const isSelected = webServer === ws.id;
                    return (
                      <button
                        key={ws.id}
                        type="button"
                        onClick={() => setWebServer(ws.id)}
                        className={`p-2.5 rounded-xl border text-left transition-all ${cardChoice(isSelected)}`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold block truncate">{ws.label}</span>
                          {ws.badge && (
                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap shrink-0 ${
                              ws.badge === 'Recommended'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}>
                              {ws.badge}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 block mt-1 truncate">{ws.desc}</span>
                        {isInstalled ? (
                          <div className="flex items-center gap-1 mt-2 text-[9px] font-medium text-emerald-600 bg-emerald-50/80 border border-emerald-200/60 px-1.5 py-0.5 rounded w-fit">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                            <span>Ready</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 mt-2 text-[9px] font-medium text-slate-400 bg-slate-50 border border-slate-200/60 px-1.5 py-0.5 rounded w-fit">
                            <span>Not installed</span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Choose which web server engine powers your application. Edge ingress transparently routes traffic to your selected engine.
                </p>
              </div>

              {appMode === 'standard' && (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-semibold text-slate-700">Language &amp; Runtime</label>
                      {effectiveSource === 'scaffold' && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-slate-100 border border-slate-200/80 px-2 py-0.5 rounded-md">
                          <Lock className="w-2.5 h-2.5 text-slate-400" />
                          Preset untuk {framework}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {[
                        { id: 'python' as RuntimeType, label: 'Python' },
                        { id: 'php' as RuntimeType, label: 'PHP' },
                        { id: 'nodejs' as RuntimeType, label: 'Node.js' },
                        { id: 'go' as RuntimeType, label: 'Golang' },
                        { id: 'rust' as RuntimeType, label: 'Rust' },
                        { id: 'ruby' as RuntimeType, label: 'Ruby' },
                      ].map((item) => {
                        const RuntimeIcon = runtimeIcon[item.id] ?? Code2;
                        const active = runtime === item.id;
                        const isDetected = expectedRuntime === item.id;
                        const isLockedByScaffold = effectiveSource === 'scaffold' && !active;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={isLockedByScaffold}
                            onClick={() => handleRuntimeChange(item.id)}
                            title={isLockedByScaffold ? `Terkunci ke runtime ${framework}. Ubah starter di langkah Source jika ingin runtime lain.` : undefined}
                            className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border relative transition-all ${
                              isLockedByScaffold
                                ? 'opacity-35 cursor-not-allowed border-slate-200 bg-slate-50/50 text-slate-400'
                                : cardChoice(active)
                            }`}
                          >
                            <RuntimeIcon className="w-4 h-4" />
                            <span className="text-[11px] font-medium">{item.label}</span>
                            {active && effectiveSource === 'scaffold' && (
                              <span className="text-[8px] font-bold text-blue-700 bg-blue-100/90 px-1.5 py-0.2 rounded-full whitespace-nowrap">
                                🔒 Preset
                              </span>
                            )}
                            {effectiveSource !== 'scaffold' && isDetected && (
                              <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded-full whitespace-nowrap">
                                ✨ Detected
                              </span>
                            )}
                            {effectiveSource !== 'scaffold' && active && isRuntimeMismatch && (
                              <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded-full whitespace-nowrap">
                                ⚠️ Mismatch
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      {effectiveSource === 'scaffold' ? (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="block text-xs font-semibold text-slate-700">Framework / Starter Template</label>
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200/80 px-1.5 py-0.5 rounded-md">
                              <Lock className="w-2.5 h-2.5" /> Read-Only Preset
                            </span>
                          </div>
                          <div className="px-3 py-2 bg-slate-50/90 border border-slate-200 rounded-lg flex items-center justify-between shadow-2xs">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-7 h-7 rounded-lg bg-blue-600/10 text-blue-600 flex items-center justify-center shrink-0">
                                <Code2 className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <span className="text-xs font-bold text-slate-900 block truncate">{framework}</span>
                                <span className="text-[10px] text-slate-400 block truncate">Scaffold starter otomatis</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setStepIndex(1)}
                              className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 hover:underline px-2 py-1 shrink-0 flex items-center gap-0.5"
                              title="Ubah starter template di langkah Source"
                            >
                              <span>Ganti</span>
                              <ChevronRight className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Framework / Template</label>
                          <select value={framework} onChange={(e) => setFramework(e.target.value)} className={inputClass}>
                            {availableFrameworks.map((fw) => (
                              <option key={fw} value={fw}>{fw}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-semibold text-slate-700">
                          Runtime Version <span className="text-slate-400 font-normal">({runtime.toUpperCase()})</span>
                        </label>
                        <span className="text-[10px] text-slate-400">Pilih versi runtime</span>
                      </div>
                      <select value={version} onChange={(e) => setVersion(e.target.value)} className={inputClass}>
                        {compatibleRuntimes.versions.map((ver) => (
                          <option key={ver} value={ver}>
                            {ver} {ver === compatibleRuntimes.recommended ? '(Direkomendasikan)' : ''}
                          </option>
                        ))}
                      </select>
                      {compatibleRuntimes.note && (
                        <p className="text-[11px] text-blue-700 mt-1.5 flex items-center gap-1 font-medium bg-blue-50/80 px-2.5 py-1 rounded-md border border-blue-100">
                          <ShieldCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                          <span>{compatibleRuntimes.note}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  {isGenericFramework ? (
                    <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 text-xs text-slate-600 flex items-start gap-3">
                      <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-2xs text-slate-600 shrink-0">
                        <FolderOpen className="w-4 h-4" />
                      </div>
                      <div className="space-y-0.5">
                        <div className="font-semibold text-slate-800">Bring Your Own Code</div>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          Kode aplikasi menggunakan sumber yang telah ditentukan di langkah Source ({effectiveSource.toUpperCase()}). Tidak ada template starter otomatis yang diunduh.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-850 bg-slate-950 text-slate-200 p-3.5 shadow-sm space-y-2.5">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
                          </div>
                          <span className="text-[10px] font-mono font-medium tracking-wide text-slate-400 uppercase ml-1">
                            {plan.mode === 'download' ? 'Scaffold Automation Recipe' : 'Template Provisioning'}
                          </span>
                        </div>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-400 border border-blue-500/30">
                          {framework}
                        </span>
                      </div>

                      {plan.install && (
                        <div className="group relative flex items-center justify-between bg-slate-900/90 border border-slate-800 rounded-lg px-3 py-2 font-mono text-[11px] text-cyan-300">
                          <div className="flex items-center gap-2 overflow-x-auto pr-2">
                            <span className="text-emerald-400 font-bold select-none">$</span>
                            <span className="whitespace-nowrap">{plan.install}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard.writeText(plan.install || '');
                              setCopiedConfig(true);
                              setTimeout(() => setCopiedConfig(false), 2000);
                            }}
                            className="text-slate-400 hover:text-white transition-colors p-1 shrink-0 flex items-center gap-1"
                            title="Copy command"
                          >
                            {copiedConfig ? (
                              <span className="text-[10px] text-emerald-400 font-sans flex items-center gap-0.5">
                                <Check className="w-3 h-3" /> Tersalin
                              </span>
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      )}

                      <div className="flex items-start gap-2 text-[11px] text-slate-400">
                        <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <p className="leading-relaxed">
                          {plan.note || 'BarePod akan mengeksekusi scaffold otomatis saat website di-deploy dan menyambungkan konfigurasi environment ke database.'}
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}

              {appMode === 'static' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Static Template</label>
                    <select value={framework} onChange={(e) => setFramework(e.target.value)} className={inputClass}>
                      {runtimeConfigs.static.frameworks.map((fw) => (
                        <option key={fw} value={fw}>{fw}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Build Tool Version</label>
                    <select value={version} onChange={(e) => setVersion(e.target.value)} className={inputClass}>
                      {runtimeConfigs.static.versions.map((ver) => (
                        <option key={ver} value={ver}>{ver}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </>
          )}

          {/* STEP: DATABASE & CACHE */}
          {currentStepId === 'database' && (
            <>
              {/* Database */}
              <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer">
                <input type="checkbox" checked={createDb} onChange={(e) => setCreateDb(e.target.checked)} className="mt-0.5 rounded border-slate-300 text-blue-600" />
                <span className="text-xs">
                  <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-slate-700" /> Provision a database
                  </span>
                  <span className="text-slate-500 block mt-0.5">Creates the database plus a dedicated user with the password below.</span>
                </span>
              </label>

              {createDb && (
                <div className="pl-5 space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {supportedDbEngines.map((item) => {
                      const engineId = item.engine;
                      const DbIcon = dbIcon[engineId] ?? Database;
                      const active = dbType === engineId;
                      return (
                        <button
                          key={engineId}
                          type="button"
                          onClick={() => { setDbType(engineId); setDbVersionIndex(0); }}
                          className={`flex flex-col items-start gap-1 p-2 rounded-lg border text-left transition-all ${cardChoice(active)}`}
                        >
                          <div className="flex items-center gap-1.5 w-full">
                            <DbIcon className="w-3.5 h-3.5 shrink-0" />
                            <span className="font-semibold text-[11px] truncate">{item.label || ENGINE_LABELS[engineId]}</span>
                          </div>
                          {item.badge && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${active ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                              {item.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <p className="text-[11px] text-slate-400">
                    Hanya database SQL relasional &amp; embedded untuk website. Untuk MongoDB atau klaster database khusus, tambahkan terpisah melalui menu <strong>Databases</strong>.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Version &amp; Port</label>
                      {/* The engine version is a host-level choice (see Stack), so the wizard
                          does not offer one: the daemon records whatever the host runs. */}
                      <div className={`${inputClass} font-mono text-slate-500 bg-slate-100`}>
                        {activeDbVersion ? `${activeDbVersion.label} · port ${activeDbVersion.port ?? '—'}` : 'host default'}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Database Name</label>
                      <input type="text" value={dbName} onChange={(e) => setDbName(e.target.value)} placeholder={resolvedDbName} className={`${inputClass} font-mono`} />
                    </div>
                  </div>

                  {!isSqlite && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Username</label>
                        <input type="text" value={dbUser} onChange={(e) => setDbUser(e.target.value)} placeholder={resolvedDbUser} className={`${inputClass} font-mono`} />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
                        <div className="relative">
                          <input
                            type={showDbPassword ? 'text' : 'password'}
                            value={dbPassword}
                            onChange={(e) => setDbPassword(e.target.value)}
                            className={`${inputClass} pr-14 font-mono`}
                          />
                          <div className="absolute right-2 top-1.5 flex items-center gap-1">
                            <button type="button" onClick={() => setShowDbPassword((v) => !v)} className="p-1 text-slate-400 hover:text-slate-600" title="Show/hide">
                              {showDbPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                            <button type="button" onClick={() => setDbPassword('bp_' + Math.random().toString(36).slice(2, 14))} className="p-1 text-slate-400 hover:text-blue-600" title="Generate">
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Max Connections</label>
                        <select value={maxConnections} onChange={(e) => setMaxConnections(Number(e.target.value))} className={inputClass}>
                          <option value={15}>15</option>
                          <option value={25}>25</option>
                          <option value={50}>50</option>
                          <option value={100}>100</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {isSqlite && (
                    <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 text-xs text-slate-600 flex items-start gap-2">
                      <KeyRound className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                      <span>SQLite is file-based (no daemon, no credentials). The database file is created inside the website directory and referenced from .env.</span>
                    </div>
                  )}
                </div>
              )}

              {/* Cache */}
              {hasCacheSupport && (
                <>
                  <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer">
                    <input type="checkbox" checked={createCache} onChange={(e) => setCreateCache(e.target.checked)} className="mt-0.5 rounded border-slate-300 text-rose-600" />
                    <span className="text-xs">
                      <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-rose-600" /> Provision a cache (Redis)
                      </span>
                      <span className="text-slate-500 block mt-0.5">In-memory cache / sessions / queues. Independent from the database — combine freely.</span>
                    </span>
                  </label>

                  {createCache && (
                    <div className="pl-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Redis Version &amp; Port</label>
                        {/* Same rule as the database: the cache version is the host's. */}
                        <div className={`${inputClass} font-mono text-slate-500 bg-slate-100`}>
                          {activeCacheVersion ? `${activeCacheVersion.label} · port ${activeCacheVersion.port ?? '—'}` : 'host default'}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Cache Password (ACL)</label>
                        <div className="relative">
                          <input
                            type={showCachePassword ? 'text' : 'password'}
                            value={cachePassword}
                            onChange={(e) => setCachePassword(e.target.value)}
                            className={`${inputClass} pr-14 font-mono`}
                          />
                          <div className="absolute right-2 top-1.5 flex items-center gap-1">
                            <button type="button" onClick={() => setShowCachePassword((v) => !v)} className="p-1 text-slate-400 hover:text-slate-600" title="Show/hide">
                              {showCachePassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                            <button type="button" onClick={() => setCachePassword('bp_' + Math.random().toString(36).slice(2, 14))} className="p-1 text-slate-400 hover:text-blue-600" title="Generate">
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {(createDb || effectiveCreateCache) && (
                <>
                  <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={autoEnv} onChange={(e) => setAutoEnv(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
                    <span className="font-semibold">Generate <code className="font-mono">.env</code> automatically from the provisioned services</span>
                  </label>

                  {autoEnv && envPreview && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Generated .env preview</label>
                      <pre className="p-3 bg-slate-950 text-emerald-300 font-mono text-[11px] rounded-xl border border-slate-800 overflow-x-auto leading-relaxed">{envPreview}</pre>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* STEP: UPSTREAM (proxy mode) */}
          {currentStepId === 'upstream' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Upstream URL / IP</label>
                <input type="text" value={upstreamUrl} onChange={(e) => setUpstreamUrl(e.target.value)} className={`${inputClass} font-mono`} />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[
                    { label: '3000 (Node/Next)', val: 'http://127.0.0.1:3000' },
                    { label: '8080 (FastAPI/Go)', val: 'http://127.0.0.1:8080' },
                    { label: '5000 (Flask/Py)', val: 'http://127.0.0.1:5000' },
                    { label: '5678 (n8n Pod)', val: 'http://127.0.0.1:5678' },
                    { label: '9000 (Portainer)', val: 'http://127.0.0.1:9000' },
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      type="button"
                      onClick={() => setUpstreamUrl(preset.val)}
                      className="px-2 py-1 text-[10px] font-mono rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer text-xs">
                  <input type="checkbox" checked={proxyWebsocket} onChange={(e) => setProxyWebsocket(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
                  <span className="font-semibold text-slate-700 flex items-center gap-1.5"><Wifi className="w-3.5 h-3.5 text-slate-500" /> WebSocket upgrade</span>
                </label>
                <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer text-xs">
                  <input type="checkbox" checked={proxyPreserveHost} onChange={(e) => setProxyPreserveHost(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
                  <span className="font-semibold text-slate-700">Preserve Host header</span>
                </label>
                <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer text-xs">
                  <input type="checkbox" checked={proxyRealIp} onChange={(e) => setProxyRealIp(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
                  <span className="font-semibold text-slate-700">Forward client IP</span>
                </label>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Timeout</label>
                  <select value={proxyTimeoutSecs} onChange={(e) => setProxyTimeoutSecs(Number(e.target.value))} className={inputClass}>
                    <option value={60}>60s (standard)</option>
                    <option value={180}>180s (long-polling)</option>
                    <option value={300}>300s (streaming)</option>
                    <option value={600}>600s (heavy export)</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {/* STEP: REVIEW */}
          {currentStepId === 'review' && (
            <>
              {isRuntimeMismatch && detectedFw && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center gap-2.5 text-xs text-amber-900 animate-in fade-in">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    Perhatian: Anda mendeploy dengan runtime <strong>{runtime.toUpperCase()}</strong> padahal sumber kode terdeteksi sebagai <strong>{detectedFw.title} ({expectedRuntime?.toUpperCase()})</strong>.
                  </span>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 text-xs">
                {[
                  ['Type', appMode === 'proxy' ? 'Reverse proxy' : appMode === 'static' ? 'Static / SPA' : 'Full web app'],
                  ['Name', name || '—'],
                  ['Domain', domain || '—'],
                  ['Website Owner', tenantUser],
                  ...(appMode !== 'proxy'
                    ? ([
                        ['Web server', webServer.toUpperCase()],
                        ['Runtime', `${runtime.toUpperCase()} ${version}`],
                        ['Framework', frameworkVersion ? `${framework} v${frameworkVersion}` : framework],
                        ['Source', effectiveSource === 'scaffold' ? 'Scaffold / download' : effectiveSource === 'github' ? `GitHub ${gitRepo || '(repo)'} @ ${gitBranch}` : effectiveSource === 'upload' ? `Upload ${uploadFile ?? '(archive)'}` : 'Existing files'],
                      ] as [string, string][])
                    : ([['Upstream', upstreamUrl]] as [string, string][])),
                  ...(!isStaticSite && appMode === 'standard'
                    ? ([
                        ['Database', createDb ? `${ENGINE_LABELS[dbType]}${isSqlite ? '' : ` :${activeDbVersion?.port}`} → ${resolvedDbName}` : 'None'],
                        ...(hasCacheSupport ? [['Cache', effectiveCreateCache ? `Redis 7.2 :${activeCacheVersion?.port ?? 6379}` : 'None']] : []),
                      ] as [string, string][])
                    : []),
                  ['Cloudflare Tunnel', tunnelEnabled ? 'Enabled' : 'Disabled'],
                ].map(([label, value]) => (
                  <div key={label} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <span className="text-slate-400">{label}</span>
                    <span className="font-semibold text-slate-800 text-right truncate">{value}</span>
                  </div>
                ))}
              </div>

              {appMode === 'standard' && plan.steps.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 text-xs space-y-1.5">
                  <span className="font-semibold text-slate-800 block">Post-deploy automation</span>
                  {plan.steps.map((step) => (
                    <div key={step} className="flex items-center gap-2 text-slate-600">
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <code className="font-mono text-[11px] truncate">{step}</code>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 bg-slate-950 overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-300 text-xs font-mono">
                    <Code2 className="w-4 h-4 text-purple-400" />
                    <span>{webServer.toUpperCase()} VirtualHost preview</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(getGeneratedConfig());
                      setCopiedConfig(true);
                      setTimeout(() => setCopiedConfig(false), 2000);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg text-slate-300 hover:bg-slate-800"
                  >
                    {copiedConfig ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedConfig ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <pre className="p-4 text-xs font-mono text-purple-300 overflow-x-auto leading-relaxed max-h-48">{getGeneratedConfig()}</pre>
              </div>

              <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                Everything runs under the <code className="font-mono">/home/{tenantUser}</code> directory with cgroup v2 resource limits.
              </p>
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-3.5 border-t border-slate-100 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={back}
            disabled={stepIndex === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-40"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>

          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">
              Cancel
            </button>
            {currentStepId === 'review' ? (
              <button
                type="button"
                onClick={handleDeploy}
                disabled={!sourceValidForMode || isSubmitting}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deploying…</span>
                  </>
                ) : (
                  <>
                    <Server className="w-3.5 h-3.5" />
                    <span>Deploy Website</span>
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={next}
                disabled={!canContinue}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-40"
              >
                <span>Continue</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
