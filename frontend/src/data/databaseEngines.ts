import type { DatabaseEngine } from '../types';
import type { DbEngineRow } from '../api/client';

export interface EngineOption {
  version: string;
  port: number;
  label: string;
  statusText: string;
}

/**
 * The engine row this host really has for a family.
 *
 * MySQL and MariaDB are one server under two names, so the row worth showing is whichever of the
 * two the host runs — a panel on MariaDB has to answer for a request made in MySQL's name.
 */
export const hostEngineRow = (rows: DbEngineRow[] | undefined, engine: DatabaseEngine): DbEngineRow | undefined => {
  const wanted = engine === 'postgres' ? 'postgresql' : engine;
  const kind = engine === 'redis' ? 'cache' : 'database';
  const candidates = (rows ?? []).filter((row) => row.kind === kind);
  const direct = candidates.find((row) => row.engine === wanted);
  if (direct && (direct.available || direct.installedVersion)) return direct;
  if (wanted === 'mysql' || wanted === 'mariadb') {
    const sibling = wanted === 'mysql' ? 'mariadb' : 'mysql';
    const other = candidates.find((row) => row.engine === sibling && (row.available || row.installedVersion));
    if (other) return other;
  }
  return direct;
};

/**
 * What this host runs, as a list the screens can show.
 *
 * Nothing is invented. An engine that is not installed says so instead of borrowing a version
 * from a catalog, and a file-based engine has no daemon to version. A version and a port that
 * were written down in the code became wrong the moment the host was set up differently — a
 * MariaDB listening on 3306 was described as "MariaDB 11.2 (Port 3308)", and that port reached
 * the generated .env.
 */
export const hostEngineOptions = (row: DbEngineRow | undefined, fallbackLabel = ''): EngineOption[] => {
  if (!row) {
    return [
      {
        version: '',
        port: 0,
        label: `${fallbackLabel || 'This engine'} — not installed`,
        statusText: 'Not installed on this host',
      },
    ];
  }
  const name = row.label;
  if (row.fileBased) {
    return [
      { version: '', port: 0, label: `${name} (file, no daemon)`, statusText: 'Embedded — no shared daemon' },
    ];
  }
  const port = row.port ?? 0;
  const version = row.installedVersion ?? '';
  if (!version) {
    return [
      { version: '', port, label: `${name} — not installed`, statusText: 'Not installed on this host' },
    ];
  }
  return [
    {
      version: `${name} ${version}`,
      port,
      label: `${name} ${version} (Port ${port})`,
      statusText: row.running ? 'Running on this host' : 'Installed, not running',
    },
  ];
};

export const ENGINE_LABELS: Record<DatabaseEngine, string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL / MariaDB',
  mariadb: 'MySQL / MariaDB',
  mongodb: 'MongoDB',
  redis: 'Redis Cache',
  sqlite: 'SQLite (file)',
};
