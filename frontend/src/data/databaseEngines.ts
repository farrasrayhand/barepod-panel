import type { DatabaseEngine } from '../types';

export interface EngineOption {
  version: string;
  port: number;
  label: string;
  statusText: string;
}

/**
 * Canonical shared-daemon version + port catalog. Used by both the Databases
 * view (Create Database) and the Add Website flow so version choices stay
 * consistent across the panel.
 */
export const AVAILABLE_ENGINE_VERSIONS: Record<DatabaseEngine, EngineOption[]> = {
  postgres: [
    { version: 'PostgreSQL 16.4', port: 5432, label: 'PostgreSQL 16.4 (Port 5432)', statusText: 'Shared Daemon Active' },
    { version: 'PostgreSQL 15.8', port: 5433, label: 'PostgreSQL 15.8 (Port 5433)', statusText: 'Shared Daemon On-Demand' },
    { version: 'PostgreSQL 14.12', port: 5434, label: 'PostgreSQL 14.12 (Port 5434)', statusText: 'Shared Daemon On-Demand' },
  ],
  mysql: [
    { version: 'MySQL 8.4 LTS', port: 3306, label: 'MySQL 8.4 LTS (Port 3306)', statusText: 'Shared Daemon Active' },
    { version: 'MySQL 8.0.36', port: 3307, label: 'MySQL 8.0.36 (Port 3307)', statusText: 'Shared Daemon Active' },
    { version: 'MariaDB 11.2', port: 3308, label: 'MariaDB 11.2 (Port 3308)', statusText: 'Shared Daemon Active' },
  ],
  mariadb: [
    { version: 'MariaDB 11.2', port: 3308, label: 'MariaDB 11.2 (Port 3308)', statusText: 'Shared Daemon Active' },
    { version: 'MySQL 8.4 LTS', port: 3306, label: 'MySQL 8.4 LTS (Port 3306)', statusText: 'Shared Daemon Active' },
  ],
  mongodb: [
    { version: 'MongoDB 7.0.8', port: 27017, label: 'MongoDB 7.0.8 (Port 27017)', statusText: 'Shared Daemon Active' },
    { version: 'MongoDB 6.0.14', port: 27018, label: 'MongoDB 6.0.14 (Port 27018)', statusText: 'Shared Daemon On-Demand' },
  ],
  redis: [
    { version: 'Redis 7.2.4', port: 6379, label: 'Redis 7.2.4 ACL (Port 6379)', statusText: 'Shared Daemon Active' },
  ],
  sqlite: [
    { version: 'SQLite 3.46', port: 0, label: 'SQLite 3.46 (file-based, no daemon)', statusText: 'Embedded — no shared daemon' },
  ],
};

export const ENGINE_LABELS: Record<DatabaseEngine, string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL / MariaDB',
  mariadb: 'MariaDB',
  mongodb: 'MongoDB',
  redis: 'Redis Cache',
  sqlite: 'SQLite (file)',
};
