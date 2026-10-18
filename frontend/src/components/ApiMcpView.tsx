import React, { useState } from 'react';
import {
  KeyRound,
  Plus,
  Copy,
  Check,
  Trash2,
  Webhook,
  ShieldCheck,
  RefreshCw,
  Send,
  Terminal,
  Ban,
} from 'lucide-react';
import { useSubRoute } from '../hooks/useSubRoute';

interface ApiMcpViewProps {
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
}

interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string;
  expiresAt: string;
  status: 'active' | 'revoked';
}

interface WebhookItem {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  lastDelivery: string;
}

const SCOPE_CATALOG = [
  { id: 'websites:read', label: 'Websites — read' },
  { id: 'websites:write', label: 'Websites — write' },
  { id: 'files:read', label: 'Files — read' },
  { id: 'files:write', label: 'Files — write' },
  { id: 'databases:read', label: 'Databases — read' },
  { id: 'databases:write', label: 'Databases — write' },
  { id: 'backup:run', label: 'Backup & migration — run' },
  { id: 'system:read', label: 'System monitoring — read' },
  { id: 'cleanup:run', label: 'Cleanup & cron — run' },
  { id: 'users:write', label: 'Users & groups — write' },
];

const EVENT_CATALOG = [
  'website.deployed',
  'website.status_changed',
  'backup.completed',
  'migration.completed',
  'cleanup.completed',
  'cert.expiring',
  'disk.threshold',
];

const MCP_TOOLS = [
  { name: 'list_websites', scope: 'websites:read', desc: 'List all websites for the tenant' },
  { name: 'create_website', scope: 'websites:write', desc: 'Provision a new website + runtime' },
  { name: 'restart_website', scope: 'websites:write', desc: 'Restart a website service' },
  { name: 'redeploy_website', scope: 'websites:write', desc: 'Trigger a git deploy (streams logs)' },
  { name: 'get_website_metrics', scope: 'websites:read', desc: 'CPU / RAM / latency time series' },
  { name: 'tail_website_logs', scope: 'websites:read', desc: 'Stream access/error logs' },
  { name: 'list_files', scope: 'files:read', desc: 'List a website directory' },
  { name: 'write_file', scope: 'files:write', desc: 'Write/overwrite a file' },
  { name: 'create_database', scope: 'databases:write', desc: 'Provision a database instance' },
  { name: 'create_backup', scope: 'backup:run', desc: 'Create a .bpod snapshot' },
  { name: 'restore_backup', scope: 'backup:run', desc: 'Restore from a snapshot (2-step)' },
  { name: 'run_cleanup', scope: 'cleanup:run', desc: 'Prune system junk + Docker' },
  { name: 'system_metrics', scope: 'system:read', desc: 'Host telemetry snapshot' },
];

export const ApiMcpView: React.FC<ApiMcpViewProps> = ({ onShowToast }) => {
  const [activeTab, setActiveTab] = useSubRoute<'tokens' | 'webhooks' | 'mcp'>('tokens');
  const [copied, setCopied] = useState<string | null>(null);

  // Tokens
  const [tokens, setTokens] = useState<ApiToken[]>([
    {
      id: 'tk-1',
      name: 'CI — GitHub Actions',
      prefix: 'bp_live_9f8a20bc',
      scopes: ['websites:read', 'websites:write'],
      lastUsedAt: '2026-10-10 18:12',
      expiresAt: '2027-01-10',
      status: 'active',
    },
    {
      id: 'tk-2',
      name: 'Agent — Claude Desktop',
      prefix: 'bp_live_4d1c77aa',
      scopes: ['websites:read', 'files:read', 'system:read'],
      lastUsedAt: '2026-10-10 17:58',
      expiresAt: 'Never',
      status: 'active',
    },
  ]);
  const [newTokenName, setNewTokenName] = useState('');
  const [newScopes, setNewScopes] = useState<string[]>(['websites:read']);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);

  // Webhooks
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([
    {
      id: 'wh-1',
      url: 'https://hooks.slack.com/services/T000/B000/XXXX',
      events: ['website.deployed', 'backup.completed'],
      active: true,
      lastDelivery: '2026-10-10 18:34 · 200 OK',
    },
  ]);
  const [newHookUrl, setNewHookUrl] = useState('');
  const [newHookEvents, setNewHookEvents] = useState<string[]>(['website.deployed']);

  const auditLog = [
    { time: '18:12:04', token: 'bp_live_9f8a20bc', method: 'POST', path: '/api/v1/websites/larastore-commerce/redeploy', status: 202 },
    { time: '17:58:31', token: 'bp_live_4d1c77aa', method: 'GET', path: '/api/v1/websites', status: 200 },
    { time: '17:44:10', token: 'bp_live_4d1c77aa', method: 'GET', path: '/api/v1/system/metrics?range=24h', status: 200 },
    { time: '16:20:55', token: 'bp_live_9f8a20bc', method: 'GET', path: '/api/v1/websites/flask-sentiment-api/logs', status: 200 },
  ];

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1800);
  };

  const createToken = () => {
    if (!newTokenName.trim()) return;
    const random = Math.random().toString(36).slice(2, 12);
    const full = `bp_live_${random}`;
    setTokens((prev) => [
      {
        id: `tk-${Date.now()}`,
        name: newTokenName.trim(),
        prefix: full.slice(0, 16),
        scopes: newScopes,
        lastUsedAt: 'Never',
        expiresAt: '2027-01-10',
        status: 'active',
      },
      ...prev,
    ]);
    setRevealedToken(full);
    setNewTokenName('');
    onShowToast?.('API Token Created', 'Copy the token now — it will not be shown again.', 'success');
  };

  const revokeToken = (id: string, name: string) => {
    setTokens((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'revoked' } : t)));
    onShowToast?.('Token Revoked', `"${name}" can no longer authenticate.`, 'info');
  };

  const addWebhook = () => {
    if (!newHookUrl.trim()) return;
    setWebhooks((prev) => [
      ...prev,
      { id: `wh-${Date.now()}`, url: newHookUrl.trim(), events: newHookEvents, active: true, lastDelivery: 'Never' },
    ]);
    setNewHookUrl('');
    onShowToast?.('Webhook Added', 'Test delivery queued.', 'success');
  };

  const mcpConfig = `{
  "mcpServers": {
    "barepod": {
      "command": "npx",
      "args": ["-y", "@barepod/mcp"],
      "env": {
        "BAREPOD_URL": "https://panel.barepod.cloud",
        "BAREPOD_TOKEN": "bp_live_xxxxxxxxxxxx"
      }
    }
  }
}`;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">API &amp; MCP</h1>
          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800">Prototype UI</span>
        </div>
        <p className="text-sm text-slate-500 mt-0.5">
          Scoped API tokens, outbound webhooks, and an MCP server so agents can automate the panel.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        {[
          { id: 'tokens' as const, label: 'API Tokens', icon: KeyRound },
          { id: 'webhooks' as const, label: 'Webhooks', icon: Webhook },
          { id: 'mcp' as const, label: 'MCP Server', icon: Terminal },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TOKENS */}
      {activeTab === 'tokens' && (
        <div className="space-y-5">
          {revealedToken && (
            <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-900">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Copy this token now — it will not be shown again.</span>
              </div>
              <div className="flex items-center justify-between gap-2 bg-white p-2 rounded-lg border border-emerald-200">
                <code className="text-xs font-mono text-emerald-800 truncate">{revealedToken}</code>
                <button
                  onClick={() => copy(revealedToken, 'revealed')}
                  className="px-2 py-1 text-xs font-semibold bg-emerald-100 text-emerald-800 hover:bg-emerald-200 rounded flex items-center gap-1 cursor-pointer"
                >
                  {copied === 'revealed' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied === 'revealed' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Create token */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
            <h2 className="text-sm font-bold text-slate-900">Create API Token</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Token Name</label>
                <input
                  type="text"
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  placeholder="e.g. CI — GitHub Actions"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={createToken}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Generate Token</span>
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2">
                Scopes <span className="text-slate-400 font-normal">(limited to your group permissions)</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                {SCOPE_CATALOG.map((scope) => (
                  <label
                    key={scope.id}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50/60 cursor-pointer text-[11px]"
                  >
                    <input
                      type="checkbox"
                      checked={newScopes.includes(scope.id)}
                      onChange={(e) =>
                        setNewScopes((prev) =>
                          e.target.checked ? [...prev, scope.id] : prev.filter((s) => s !== scope.id),
                        )
                      }
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-slate-700 font-mono">{scope.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Token list */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
            <table className="min-w-[560px] w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[10px]">
                <tr>
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Token</th>
                  <th className="py-3 px-4">Scopes</th>
                  <th className="py-3 px-4">Last Used</th>
                  <th className="py-3 px-4">Expires</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tokens.map((token) => (
                  <tr key={token.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-semibold text-slate-800">{token.name}</td>
                    <td className="py-3 px-4 font-mono text-slate-500">{token.prefix}…</td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {token.scopes.map((s) => (
                          <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">{s}</span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">{token.lastUsedAt}</td>
                    <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">{token.expiresAt}</td>
                    <td className="py-3 px-4 text-right">
                      {token.status === 'revoked' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded">
                          <Ban className="w-3 h-3" /> Revoked
                        </span>
                      ) : (
                        <button
                          onClick={() => revokeToken(token.id, token.name)}
                          className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Revoke token"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          {/* Audit log */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900">Recent API Activity</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {auditLog.map((entry, idx) => (
                <div key={idx} className="px-5 py-2.5 flex items-center justify-between gap-3 text-[11px] font-mono">
                  <span className="text-slate-400">{entry.time}</span>
                  <span className="text-slate-500">{entry.token}…</span>
                  <span className={`px-1.5 py-0.5 rounded font-bold ${entry.method === 'GET' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                    {entry.method}
                  </span>
                  <span className="text-slate-700 truncate flex-1">{entry.path}</span>
                  <span className={`font-bold ${entry.status < 300 ? 'text-emerald-600' : 'text-rose-600'}`}>{entry.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* WEBHOOKS */}
      {activeTab === 'webhooks' && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
            <h2 className="text-sm font-bold text-slate-900">Add Outbound Webhook</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-slate-700 mb-1">Endpoint URL</label>
                <input
                  type="text"
                  value={newHookUrl}
                  onChange={(e) => setNewHookUrl(e.target.value)}
                  placeholder="https://example.com/hooks/barepod"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:outline-hidden focus:border-blue-500"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={addWebhook}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Webhook</span>
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2">Events</label>
              <div className="flex flex-wrap gap-1.5">
                {EVENT_CATALOG.map((event) => (
                  <button
                    key={event}
                    type="button"
                    onClick={() =>
                      setNewHookEvents((prev) =>
                        prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
                      )
                    }
                    className={`px-2.5 py-1 rounded-lg border text-[11px] font-mono transition-all cursor-pointer ${
                      newHookEvents.includes(event)
                        ? 'border-blue-600 bg-blue-50 text-blue-800 font-bold'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    {event}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Payloads are signed with HMAC-SHA256 in the <code className="font-mono">X-BarePod-Signature</code> header.
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
            <table className="min-w-[560px] w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[10px]">
                <tr>
                  <th className="py-3 px-4">Endpoint</th>
                  <th className="py-3 px-4">Events</th>
                  <th className="py-3 px-4">Last Delivery</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {webhooks.map((hook) => (
                  <tr key={hook.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono text-slate-700 truncate max-w-[280px]">{hook.url}</td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {hook.events.map((e) => (
                          <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">{e}</span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">{hook.lastDelivery}</td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => onShowToast?.('Test Delivery', `Sent a sample payload to ${hook.url}.`, 'info')}
                          className="p-1.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                          title="Send test delivery"
                        >
                          <Send className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setWebhooks((prev) => prev.filter((w) => w.id !== hook.id))}
                          className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Delete webhook"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}

      {/* MCP */}
      {activeTab === 'mcp' && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-3">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-slate-700" />
              <h2 className="text-sm font-bold text-slate-900">Connect an MCP client</h2>
            </div>
            <p className="text-xs text-slate-500">
              The MCP server wraps the REST API and runs on your machine — it authenticates with an API token, never your panel password.
            </p>
            <div className="relative">
              <pre className="p-4 bg-slate-950 text-emerald-300 font-mono text-[11px] rounded-xl border border-slate-800 overflow-x-auto leading-relaxed">{mcpConfig}</pre>
              <button
                onClick={() => copy(mcpConfig, 'mcp')}
                className="absolute top-2.5 right-2.5 flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 cursor-pointer"
              >
                {copied === 'mcp' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied === 'mcp' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Available Tools ({MCP_TOOLS.length})</h2>
              <span className="text-[11px] text-slate-400 font-mono">read-only unless the token has :write</span>
            </div>
            <div className="overflow-x-auto">
            <table className="min-w-[560px] w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[10px]">
                <tr>
                  <th className="py-3 px-5">Tool</th>
                  <th className="py-3 px-5">Required Scope</th>
                  <th className="py-3 px-5">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {MCP_TOOLS.map((tool) => (
                  <tr key={tool.name} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-5 font-mono font-semibold text-slate-800">{tool.name}</td>
                    <td className="py-2.5 px-5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">{tool.scope}</span>
                    </td>
                    <td className="py-2.5 px-5 text-slate-500">{tool.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 flex items-start gap-2.5 text-xs text-slate-600">
            <RefreshCw className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            <span>
              Requires the backend REST API (Phase 2). Until then this screen is a UI blueprint of the planned token/webhook/MCP surface.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
