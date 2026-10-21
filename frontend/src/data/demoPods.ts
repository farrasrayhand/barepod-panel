import type { PodItem } from '../types';

export const BAREPOD_DEMO_PODS: PodItem[] = [
  {
    id: 'pod-1',
    name: 'redis-cache-cluster',
    tenantUser: 'admin',
    sourceType: 'image',
    image: 'redis:7.2-alpine',
    status: 'running',
    ports: '6379:6379',
    cpu: '0.4%',
    memory: '28 MB',
    restartPolicy: 'unless-stopped',
    isWebApp: false,
    volumes: [
      { hostPath: 'redis_cache_data', containerPath: '/data', readOnly: false }
    ],
    envVars: [
      { key: 'REDIS_MAXMEMORY', value: '256mb', isSecret: false }
    ],
    memoryLimit: '512 MB',
    cpuLimit: '0.5 core',
  },
  {
    id: 'pod-2',
    name: 'typesense-search',
    tenantUser: 'suprion7',
    sourceType: 'image',
    image: 'typesense/typesense:26.0',
    status: 'running',
    ports: '8108:8108',
    cpu: '1.2%',
    memory: '180 MB',
    restartPolicy: 'always',
    isWebApp: true,
    webDomain: 'typesense.demo.barepod.cloud',
    webPort: 8108,
    sslEnabled: true,
    volumes: [
      { hostPath: 'typesense_data', containerPath: '/data', readOnly: false }
    ],
    envVars: [
      { key: 'TYPESENSE_API_KEY', value: 'xyz_search_secret_key_prod', isSecret: true },
      { key: 'TYPESENSE_DATA_DIR', value: '/data', isSecret: false }
    ],
    memoryLimit: '1 GB',
    cpuLimit: '1.0 core',
  },
  {
    id: 'pod-3',
    name: 'n8n-workflow-automation',
    tenantUser: 'admin',
    sourceType: 'compose',
    image: 'n8nio/n8n:latest',
    status: 'running',
    ports: '5678:5678',
    cpu: '2.5%',
    memory: '310 MB',
    restartPolicy: 'unless-stopped',
    isWebApp: true,
    webDomain: 'n8n.workflow.barepod.cloud',
    webPort: 5678,
    sslEnabled: true,
    useCloudflareTunnel: true,
    volumes: [
      { hostPath: 'n8n_storage', containerPath: '/home/node/.n8n', readOnly: false }
    ],
    envVars: [
      { key: 'N8N_HOST', value: 'n8n.workflow.barepod.cloud', isSecret: false },
      { key: 'N8N_PORT', value: '5678', isSecret: false },
      { key: 'N8N_PROTOCOL', value: 'https', isSecret: false },
      { key: 'NODE_ENV', value: 'production', isSecret: false },
      { key: 'WEBHOOK_URL', value: 'https://n8n.workflow.barepod.cloud/', isSecret: false }
    ],
    memoryLimit: '2 GB',
    cpuLimit: '2.0 cores',
    basicAuthEnabled: true,
    basicAuthUser: 'admin',
    basicAuthPassword: 'N8nSecurePass2026!',
    basicAuthRealm: 'n8n Automation Engine',
  },
];

