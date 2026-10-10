export type NavItem = 
  | 'overview'
  | 'monitoring'
  | 'apps'
  | 'pods'
  | 'databases'
  | 'domains'
  | 'tunnels'
  | 'terminal'
  | 'users'
  | 'settings';

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
  webServer: WebServerType;
  tenantUser: string;
  status: 'running' | 'stopped' | 'building' | 'error';
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
  // Metrics & Telemetry Retention (Max 30 days per app)
  metricsRetentionDays?: number;
}

export type DatabaseEngine = 'postgres' | 'mysql' | 'mariadb' | 'mongodb' | 'redis';

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

export interface UserGroup {
  id: string;
  name: string;
  description: string;
  maxSites: number | 'Unlimited';
  diskLimit: string;
  maxDatabases: number | 'Unlimited';
  ramLimit: string;
  cpuLimit: string;
  allowTerminal: boolean;
  userCount: number;
}

export interface TenantUser {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  groupName: string;
  sitesCount: number;
  maxSites: number | 'Unlimited';
  diskUsage: string;
  diskLimit: string;
  dbCount: number;
  maxDatabases: number | 'Unlimited';
  status: 'active' | 'suspended';
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
