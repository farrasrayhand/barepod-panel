export interface PhpExtensionItem {
  name: string;
  category: 'core' | 'database' | 'cache' | 'media' | 'security' | 'rpc';
  description: string;
  enabled: boolean;
  version?: string;
  isPecl?: boolean;
}

export const MASTER_PHP_EXTENSIONS: PhpExtensionItem[] = [
  // Database Drivers
  { name: 'pdo_mysql', category: 'database', description: 'MySQL 8 & MariaDB PDO relational database driver', enabled: true, version: '8.4.2' },
  { name: 'pdo_pgsql', category: 'database', description: 'PostgreSQL 16 PDO relational database driver', enabled: true, version: '8.4.2' },
  { name: 'pdo_sqlite', category: 'database', description: 'SQLite3 embedded file-based PDO database driver', enabled: true, version: '8.4.2' },
  { name: 'mongodb', category: 'database', description: 'MongoDB official NoSQL BSON client driver', enabled: true, version: '1.18.1', isPecl: true },
  { name: 'sqlsrv', category: 'database', description: 'Microsoft SQL Server & Azure SQL DB PDO driver', enabled: false, version: '5.12.0', isPecl: true },

  // Cache, Accelerators & Concurrency
  { name: 'redis', category: 'cache', description: 'In-memory Redis cache client & session handler', enabled: true, version: '6.0.2', isPecl: true },
  { name: 'opcache', category: 'cache', description: 'Zend OPcache bytecode acceleration & JIT compiler engine', enabled: true, version: '8.4.2' },
  { name: 'swoole', category: 'cache', description: 'High-concurrency async coroutine event runtime (Laravel Octane)', enabled: false, version: '5.1.2', isPecl: true },
  { name: 'apcu', category: 'cache', description: 'APC User Cache in-memory key-value data caching', enabled: false, version: '5.1.23', isPecl: true },
  { name: 'igbinary', category: 'cache', description: 'Compact high-speed binary serializer replacement for PHP serialize()', enabled: false, version: '3.2.15', isPecl: true },
  { name: 'memcached', category: 'cache', description: 'Memcached distributed memory object caching client', enabled: false, version: '3.2.0', isPecl: true },

  // Core & Engine Utilities
  { name: 'bcmath', category: 'core', description: 'Arbitrary precision mathematics for financial decimal calculations', enabled: true, version: '8.4.2' },
  { name: 'zip', category: 'core', description: 'Zip archive compression, packaging & extraction library', enabled: true, version: '1.22.3' },
  { name: 'intl', category: 'core', description: 'Internationalization & ICU Unicode collation formatting', enabled: true, version: '8.4.2' },
  { name: 'xml', category: 'core', description: 'DOM, SimpleXML, and XMLReader parsing engines', enabled: true, version: '8.4.2' },
  { name: 'curl', category: 'core', description: 'libcurl client for external HTTP/REST API outbound requests', enabled: true, version: '8.4.2' },
  { name: 'pcntl', category: 'core', description: 'Process control & signal handling for queue worker supervisors', enabled: true, version: '8.4.2' },
  { name: 'soap', category: 'core', description: 'Simple Object Access Protocol client and server provider', enabled: false, version: '8.4.2' },
  { name: 'yaml', category: 'core', description: 'YAML 1.2 data serialization parsing and emitting', enabled: false, version: '2.2.3', isPecl: true },

  // Media & Imaging
  { name: 'gd', category: 'media', description: 'GD graphics drawing, thumbnail generation & WebP/PNG resizing', enabled: true, version: '2.3.3' },
  { name: 'imagick', category: 'media', description: 'ImageMagick image processing, format conversion & PDF rendering', enabled: true, version: '3.7.0', isPecl: true },
  { name: 'exif', category: 'media', description: 'Exchangeable Image File Format header & metadata reader', enabled: true, version: '8.4.2' },

  // RPC & Microservices
  { name: 'grpc', category: 'rpc', description: 'Google RPC high-performance client/server framework', enabled: false, version: '1.62.0', isPecl: true },
  { name: 'protobuf', category: 'rpc', description: 'Google Protocol Buffers binary data serialization', enabled: false, version: '4.26.1', isPecl: true },

  // Security, Profiling & Commercial
  { name: 'sodium', category: 'security', description: 'Modern high-security cryptographic functions (libsodium)', enabled: true, version: '8.4.2' },
  { name: 'ioncube', category: 'security', description: 'IonCube Loader for executing encoded PHP commercial software', enabled: false, version: '13.0.4' },
  { name: 'xdebug', category: 'security', description: 'Step debugger and code profiler for development environments', enabled: false, version: '3.3.2', isPecl: true },
  { name: 'pcov', category: 'security', description: 'Ultra-fast lightweight code coverage driver for PHPUnit testing', enabled: false, version: '1.0.11', isPecl: true },
];
