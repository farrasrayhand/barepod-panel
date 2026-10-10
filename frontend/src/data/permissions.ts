import type { GroupPermissions } from '../types';

export const ALL_PERMISSIONS: GroupPermissions = {
  deployApps: true,
  fileManager: true,
  terminal: true,
  databases: true,
  backups: true,
  domains: true,
  cloudflareTunnels: true,
  monitoring: true,
  users: true,
};

export const PERMISSION_MATRIX: Array<{ key: keyof GroupPermissions; label: string; desc: string }> = [
  { key: 'deployApps', label: 'Deploy & manage apps', desc: 'Create, start/stop, redeploy' },
  { key: 'fileManager', label: 'File Manager', desc: 'Browse and edit app files' },
  { key: 'terminal', label: 'Web Terminal (SSH CLI)', desc: 'Open the isolated tenant shell' },
  { key: 'databases', label: 'Databases', desc: 'Create and manage databases' },
  { key: 'backups', label: 'Backup & migration', desc: 'Snapshots, restore, migration' },
  { key: 'domains', label: 'Domains & SSL', desc: 'Bind domains and manage certificates' },
  { key: 'cloudflareTunnels', label: 'Cloudflare Tunnels', desc: 'Publish apps with Zero-NAT' },
  { key: 'monitoring', label: 'Server monitoring', desc: 'View host telemetry' },
  { key: 'users', label: 'User & group management', desc: 'Admin-only by default' },
];

export const countPermissions = (permissions?: GroupPermissions): number =>
  permissions ? Object.values(permissions).filter(Boolean).length : 0;
