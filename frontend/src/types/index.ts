export type NavItem = 
  | 'overview'
  | 'monitoring'
  | 'web'
  | 'pods'
  | 'databases'
  | 'domains'
  | 'tunnels'
  | 'terminal'
  | 'users'
  | 'stack'
  | 'settings'
  | 'api'
  | 'profile'
  | 'files'
  | 'backup';

export type RuntimeType = 
  | 'php' 
  | 'nodejs' 
  | 'python' 
  | 'go' 
  | 'rust' 
  | 'ruby' 
  | 'docker' 
  | 'static' 
  | 'proxy';

export type WebServerType = 'caddy' | 'nginx' | 'openlitespeed' | 'apache';

export interface WebApp {
  id: string;
  name: string;
  domain: string;
  runtime: RuntimeType;
  version: string;
  framework?: string;
  frameworkVersion?: string;
  webServer: WebServerType;
  tenantUser: string;
  status: 'running' | 'stopped' | 'suspended' | 'building' | 'error';
  deployStatus?: 'pending' | 'building' | 'ready' | 'failed';
  ssl: boolean;
  tunnelEnabled: boolean;
  tunnelRoute?: string;
  port: number;
  memoryUsage: string;
  cpuUsage: string;
  createdAt: string;
  path?: string;
  upstreamUrl?: string;
  proxyWebsocket?: boolean;
  proxyPreserveHost?: boolean;
  proxyRealIp?: boolean;
  proxyTimeoutSecs?: number;
  customHeaders?: { key: string; value: string }[];
  routes?: { path: string; upstream: string; target: string; cache: string; websocket?: boolean }[];
  // Maintenance & Access Control
  maintenanceMode?: boolean;
  maintenanceMessage?: string;
  maintenanceBypassIps?: string;
  basicAuthEnabled?: boolean;
  basicAuthUser?: string;
  basicAuthPassword?: string;
  basicAuthRealm?: string;
  basicAuthBypassIps?: string;
  // Anti-Brute Force Protection
  antiBruteforce?: boolean;
  antiBruteforceMaxAttempts?: number;
  antiBruteforceBanMinutes?: number;
  // Metrics & Telemetry Retention (Max 30 days per app)
  metricsRetentionDays?: number;
  // CI/CD, Git Repository & Build Script (Persistent per-app)
  gitRepo?: string;
  gitBranch?: string;
  autoDeploy?: boolean;
  buildScript?: string;
  deployHookToken?: string;
  lastDeployedAt?: string;
  lastDeployCommit?: string;
  // Deployment wizard: database provisioning & automation
  dbAutoProvision?: boolean;
  dbEngine?: DatabaseEngine;
  dbName?: string;
  dbUser?: string;
  cacheAutoProvision?: boolean;
  cacheEngine?: 'redis';
  autoEnv?: boolean;
  /** Where the code came from, as the deploy wizard chose it (see the API contract). */
  sourceKind?: 'scaffold' | 'github' | 'upload' | 'existing' | 'default';
  provisionMode?: 'download' | 'generic';
  automationSteps?: string[];
  env?: Record<string, string>;
}

export type DatabaseEngine = 'postgres' | 'mysql' | 'mariadb' | 'mongodb' | 'redis' | 'sqlite';

export interface DatabaseItem {
  id: string;
  name: string;
  type: DatabaseEngine;
  version: string;
  username: string;
  size: string;
  charset: string;
  status: 'active' | 'inactive';
  connections: number;
  host?: string;
  port?: number;
  tenantUser?: string;
  maxConnections?: number;
  isolationMode?: 'shared_daemon' | 'dedicated_pod';
  passwordRotatedAt?: string;
  deletedAt?: string;
  /** Kept when its website was deleted: the file moved into the tenant's home. */
  detachedAt?: string;
  /**
   * "" or "private" until an operator opens the port, then "public". The note is what the panel
   * actually did about it — an engine whose listener is engine-wide says so there rather than
   * pretending a per-database boundary exists.
   */
  exposure?: string;
  exposureNote?: string;
  exposedAt?: string;
  /** Live extras: what the daemon answered. */
  note?: string;
  websiteSlug?: string;
  fileBased?: boolean;
  detected?: boolean;
  path?: string;
}

export interface SharedEngineInstance {
  id: string;
  engine: DatabaseEngine;
  version: string;
  port: number;
  status: 'running' | 'idle' | 'stopped';
  databasesCount: number;
  memoryUsage: string;
  description: string;
}

export type PodSourceType = 'image' | 'dockerfile' | 'compose';

export interface PodEnvVar {
  key: string;
  value: string;
  isSecret?: boolean;
}

export interface PodVolumeMount {
  hostPath: string;
  containerPath: string;
  readOnly?: boolean;
}

export interface PodItem {
  id: string;
  name: string;
  tenantUser?: string;
  sourceType?: PodSourceType;
  image: string;
  dockerfileContent?: string;
  composeContent?: string;
  status: 'running' | 'stopped' | 'restarting';
  ports: string;
  cpu: string;
  memory: string;
  restartPolicy: string;
  // Web Application & Routing Configuration
  isWebApp?: boolean;
  webDomain?: string;
  webPort?: number;
  sslEnabled?: boolean;
  useCloudflareTunnel?: boolean;
  // Maintenance & Access Control (for web containers)
  maintenanceMode?: boolean;
  maintenanceMessage?: string;
  maintenanceBypassIps?: string;
  basicAuthEnabled?: boolean;
  basicAuthUser?: string;
  basicAuthPassword?: string;
  basicAuthRealm?: string;
  basicAuthBypassIps?: string;
  // Env & Storage
  envVars?: PodEnvVar[];
  volumes?: PodVolumeMount[];
  memoryLimit?: string;
  cpuLimit?: string;
  command?: string;
}

export interface GroupPermissions {
  deployApps: boolean;
  fileManager: boolean;
  terminal: boolean;
  databases: boolean;
  backups: boolean;
  domains: boolean;
  cloudflareTunnels: boolean;
  monitoring: boolean;
  users: boolean;
  apiTokens: boolean;
}

export interface IngressRoute {
  hostname: string;
  service: string;
  appName: string;
  status: 'Healthy' | 'Degraded';
}

export interface UserTunnel {
  id: string;
  tenantUser: string;
  tunnelName: string;
  token: string;
  status: 'connected' | 'disconnected' | 'configuring';
  connectorVersion: string;
  uptime: string;
  routes: IngressRoute[];
}

export interface CloudflareTunnelConfig {
  status: 'connected' | 'disconnected' | 'configuring';
  tunnelName: string;
  tunnelId: string;
  tokenConfigured: boolean;
  connectorVersion: string;
  routesCount: number;
  uptime: string;
}

export interface UpdateInfo {
  hasUpdate: boolean;
  latestVersion: string;
  currentVersion: string;
  releaseTag?: string;
  changelogMarkdown?: string;
  publishedAt?: string;
}
