import type { IconType } from 'react-icons';
import {
  SiPython,
  SiPhp,
  SiNodedotjs,
  SiGo,
  SiRuby,
  SiRust,
  SiFlask,
  SiFastapi,
  SiDjango,
  SiLaravel,
  SiSymfony,
  SiWordpress,
  SiCodeigniter,
  SiDrupal,
  SiJoomla,
  SiNextdotjs,
  SiReact,
  SiExpress,
  SiPostgresql,
  SiMysql,
  SiMariadb,
  SiMongodb,
  SiRedis,
  SiNginx,
  SiApache,
  SiCaddy,
  SiDocker,
  SiCloudflare,
  SiPhpmyadmin,
  SiSqlite,
} from 'react-icons/si';

export const runtimeIcon: Record<string, IconType> = {
  python: SiPython,
  php: SiPhp,
  nodejs: SiNodedotjs,
  go: SiGo,
  rust: SiRust,
  ruby: SiRuby,
  docker: SiDocker,
};

export const frameworkIcon = (framework?: string): IconType | null => {
  const f = (framework || '').toLowerCase();
  if (f.includes('flask')) return SiFlask;
  if (f.includes('fastapi')) return SiFastapi;
  if (f.includes('django')) return SiDjango;
  if (f.includes('laravel')) return SiLaravel;
  if (f.includes('symfony')) return SiSymfony;
  if (f.includes('codeigniter')) return SiCodeigniter;
  if (f.includes('drupal')) return SiDrupal;
  if (f.includes('joomla')) return SiJoomla;
  if (f.includes('wordpress') || f.includes('woocommerce')) return SiWordpress;
  if (f.includes('next')) return SiNextdotjs;
  if (f.includes('express')) return SiExpress;
  if (f.includes('react')) return SiReact;
  return null;
};

export const dbIcon: Record<string, IconType> = {
  postgres: SiPostgresql,
  mysql: SiMysql,
  mariadb: SiMariadb,
  mongodb: SiMongodb,
  redis: SiRedis,
  sqlite: SiSqlite,
};

export const webServerIcon: Record<string, IconType> = {
  nginx: SiNginx,
  apache: SiApache,
  caddy: SiCaddy,
  openlitespeed: SiNginx,
};

export const guiToolIcon: Record<string, IconType> = {
  phpmyadmin: SiPhpmyadmin,
  pgadmin: SiPostgresql,
  mongoexpress: SiMongodb,
  rediscommander: SiRedis,
  dbgate: SiPostgresql,
};

export const brandIcons = {
  SiCloudflare,
  SiDocker,
};
