import React, { useState, useEffect } from 'react';
import { 
  Globe, 
  ShieldCheck, 
  ShieldAlert,
  Plus, 
  RefreshCw, 
  ExternalLink, 
  Check, 
  Lock, 
  Unlock,
  AlertCircle, 
  Search,
  Server,
  ArrowUpRight,
  Trash2,
  Key,
  FileCode,
  Sliders,
  X,
  CheckCircle2,
  Sparkles,
  Info
} from 'lucide-react';
import { api, type ApiDomain, type ApiWebsite } from '../api/client';
import type { WebApp } from '../types';

interface DomainsViewProps {
  apps?: WebApp[];
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
}

export const DomainsView: React.FC<DomainsViewProps> = ({ onShowToast }) => {
  const [domains, setDomains] = useState<ApiDomain[]>([]);
  const [websites, setWebsites] = useState<ApiWebsite[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'primary' | 'alias' | 'ssl' | 'no-ssl'>('all');

  // Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<ApiDomain | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState<ApiDomain | null>(null);

  // Add Domain Form
  const [addWebsiteSlug, setAddWebsiteSlug] = useState('');
  const [addDomainName, setAddDomainName] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  // SSL Modal Form
  const [sslTab, setSslTab] = useState<'auto' | 'custom' | 'settings'>('auto');
  const [sslProvider, setSslProvider] = useState<'auto' | 'letsencrypt' | 'self_signed'>('auto');
  const [sslEmail, setSslEmail] = useState('');
  const [sslForceHttps, setSslForceHttps] = useState(true);
  const [sslHsts, setSslHsts] = useState(false);
  const [customCert, setCustomCert] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [sslLoading, setSslLoading] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [domRes, webRes] = await Promise.all([
        api.domains().catch(() => ({ items: [] })),
        api.websites().catch(() => ({ items: [] })),
      ]);
      setDomains(domRes.items || []);
      setWebsites(webRes.items || []);
      if (webRes.items && webRes.items.length > 0 && !addWebsiteSlug) {
        setAddWebsiteSlug(webRes.items[0].slug);
      }
    } catch (err: any) {
      onShowToast?.('Fetch Error', err?.message || 'Failed to load domains', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addWebsiteSlug || !addDomainName.trim()) {
      onShowToast?.('Invalid Input', 'Please select a website and enter a valid domain name.', 'error');
      return;
    }

    try {
      setAddLoading(true);
      const newDomain = await api.addDomain({
        websiteSlug: addWebsiteSlug,
        domain: addDomainName.trim(),
      });
      onShowToast?.('Domain Added', `Domain '${newDomain.domain}' was successfully attached.`, 'success');
      setShowAddModal(false);
      setAddDomainName('');
      await fetchData();
      // Prompt to manage SSL
      setSelectedDomain(newDomain);
    } catch (err: any) {
      onShowToast?.('Add Domain Failed', err?.message || 'Could not attach domain.', 'error');
    } finally {
      setAddLoading(false);
    }
  };

  const handleDeleteDomain = async () => {
    if (!showDeleteModal) return;
    try {
      await api.deleteDomain(showDeleteModal.id);
      onShowToast?.('Domain Removed', `Domain '${showDeleteModal.domain}' has been detached.`, 'success');
      setShowDeleteModal(null);
      await fetchData();
    } catch (err: any) {
      onShowToast?.('Delete Failed', err?.message || 'Could not delete domain.', 'error');
    }
  };

  const handleIssueSSL = async () => {
    if (!selectedDomain) return;
    try {
      setSslLoading(true);
      const res = await api.issueSsl(selectedDomain.id, {
        provider: sslProvider,
        forceHTTPS: sslForceHttps,
        hsts: sslHsts,
        email: sslEmail.trim() || undefined,
      });

      if (res.warning) {
        onShowToast?.('SSL Issued with Warning', res.warning, 'info');
      } else {
        onShowToast?.('SSL Certificate Active', `TLS Certificate for '${selectedDomain.domain}' is now active.`, 'success');
      }
      setSelectedDomain(null);
      await fetchData();
    } catch (err: any) {
      onShowToast?.('SSL Issuance Failed', err?.message || 'Could not issue SSL certificate.', 'error');
    } finally {
      setSslLoading(false);
    }
  };

  const handleUploadCustomSSL = async () => {
    if (!selectedDomain) return;
    if (!customCert.trim() || !customKey.trim()) {
      onShowToast?.('Missing Certificate or Key', 'Please provide both Certificate (PEM) and Private Key (PEM).', 'error');
      return;
    }

    try {
      setSslLoading(true);
      await api.uploadCustomSsl(selectedDomain.id, {
        certificate: customCert,
        privateKey: customKey,
        forceHTTPS: sslForceHttps,
        hsts: sslHsts,
      });
      onShowToast?.('Custom SSL Installed', `Custom TLS keypair installed for '${selectedDomain.domain}'.`, 'success');
      setSelectedDomain(null);
      setCustomCert('');
      setCustomKey('');
      await fetchData();
    } catch (err: any) {
      onShowToast?.('SSL Installation Failed', err?.message || 'Validation failed for custom certificate.', 'error');
    } finally {
      setSslLoading(false);
    }
  };

  const handleToggleSettings = async (domain: ApiDomain, field: 'forceHTTPS' | 'hsts' | 'autoRenew', newVal: boolean) => {
    const oldVal = field === 'forceHTTPS' ? domain.forceHttps : field === 'hsts' ? domain.hstsEnabled : domain.autoRenew;

    // Optimistic UI update
    setDomains((prev) =>
      prev.map((d) =>
        d.id === domain.id
          ? {
              ...d,
              forceHttps: field === 'forceHTTPS' ? newVal : d.forceHttps,
              hstsEnabled: field === 'hsts' ? newVal : d.hstsEnabled,
              autoRenew: field === 'autoRenew' ? newVal : d.autoRenew,
            }
          : d
      )
    );

    try {
      const payload: any = {};
      if (field === 'forceHTTPS') payload.forceHTTPS = newVal;
      if (field === 'hsts') payload.hsts = newVal;
      if (field === 'autoRenew') payload.autoRenew = newVal;

      await api.toggleSsl(domain.id, payload);
      onShowToast?.('Setting Updated', `Domain '${domain.domain}' configuration reloaded.`, 'success');
      await fetchData();
    } catch (err: any) {
      // Revert optimistic update
      setDomains((prev) =>
        prev.map((d) =>
          d.id === domain.id
            ? {
                ...d,
                forceHttps: field === 'forceHTTPS' ? oldVal : d.forceHttps,
                hstsEnabled: field === 'hsts' ? oldVal : d.hstsEnabled,
                autoRenew: field === 'autoRenew' ? oldVal : d.autoRenew,
              }
            : d
        )
      );
      onShowToast?.('Update Failed', err?.message || 'Could not update setting.', 'error');
    }
  };

  const openSSLModal = (dom: ApiDomain) => {
    setSelectedDomain(dom);
    setSslForceHttps(dom.forceHttps);
    setSslHsts(dom.hstsEnabled);
    setSslTab(dom.sslProvider === 'custom' ? 'custom' : 'auto');
    setSslProvider(dom.sslProvider === 'self_signed' ? 'self_signed' : 'auto');
  };

  // Filtered domains
  const filtered = domains.filter(d => {
    const matchesSearch = 
      d.domain.toLowerCase().includes(search.toLowerCase()) || 
      d.websiteSlug.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;

    if (filterType === 'primary') return d.isPrimary;
    if (filterType === 'alias') return !d.isPrimary;
    if (filterType === 'ssl') return d.sslEnabled;
    if (filterType === 'no-ssl') return !d.sslEnabled;
    return true;
  });

  const totalSslActive = domains.filter(d => d.sslEnabled).length;
  const totalAutoRenew = domains.filter(d => d.autoRenew).length;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-200">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Domains & SSL Certificates</h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              Automated TLS
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Manage FQDN domains, multi-domain aliases, Let's Encrypt automated issuance, and custom SSL certificates.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
            title="Reload domain list"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Domain Alias</span>
          </button>
        </div>
      </div>

      {/* Metrics Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500">Configured Hostnames</div>
            <div className="text-2xl font-bold text-slate-900 mt-0.5">{domains.length}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {domains.filter(d => d.isPrimary).length} Primary &bull; {domains.filter(d => !d.isPrimary).length} Aliases
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Globe className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500">Active TLS / SSL</div>
            <div className="text-2xl font-bold text-emerald-600 mt-0.5">{totalSslActive} / {domains.length}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {domains.filter(d => d.sslProvider === 'letsencrypt').length} Let's Encrypt &bull; {domains.filter(d => d.sslProvider === 'self_signed').length} Self-Signed
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500">HTTPS Redirection & HSTS</div>
            <div className="text-2xl font-bold text-slate-900 mt-0.5">{totalAutoRenew}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Auto-renewal & 301 Force HTTPS enabled</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
            <Lock className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Domain List Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search domain or website..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 w-64 font-mono text-slate-800 placeholder-slate-400"
              />
            </div>

            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-[11px] font-semibold text-slate-600">
              {(['all', 'primary', 'alias', 'ssl', 'no-ssl'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setFilterType(type)}
                  className={`px-2.5 py-1 rounded-md transition-colors capitalize ${
                    filterType === type ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'hover:text-slate-900'
                  }`}
                >
                  {type === 'ssl' ? 'SSL Active' : type === 'no-ssl' ? 'No SSL' : type}
                </button>
              ))}
            </div>
          </div>

          <span className="text-xs text-slate-400 font-mono">
            {filtered.length} of {domains.length} Domains Configured
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px] tracking-wider">
              <tr>
                <th className="py-3 px-4">DOMAIN / FQDN</th>
                <th className="py-3 px-4">ROLE</th>
                <th className="py-3 px-4">WEBSITE</th>
                <th className="py-3 px-4">SSL / TLS STATUS</th>
                <th className="py-3 px-4">POLICY</th>
                <th className="py-3 px-4">EXPIRY & ISSUER</th>
                <th className="py-3 px-4 text-right">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-slate-400" />
                    Loading domain registry...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <Globe className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                    No domains found matching your criteria.
                  </td>
                </tr>
              ) : (
                filtered.map((d) => {
                  const targetWeb = websites.find(w => w.slug === d.websiteSlug);
                  const isExpiringSoon = d.sslExpiresAt && (new Date(d.sslExpiresAt).getTime() - Date.now()) < 15 * 86400000;

                  return (
                    <tr key={d.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* Domain */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <Globe className="w-4 h-4 text-blue-600 shrink-0" />
                          <a
                            href={`${d.sslEnabled ? 'https' : 'http'}://${d.domain}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-bold text-slate-900 hover:text-blue-600 hover:underline flex items-center gap-1"
                          >
                            <span>{d.domain}</span>
                            <ArrowUpRight className="w-3 h-3 text-slate-400" />
                          </a>
                        </div>
                      </td>

                      {/* Primary vs Alias */}
                      <td className="py-3.5 px-4">
                        {d.isPrimary ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                            Primary
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                            Alias
                          </span>
                        )}
                      </td>

                      {/* Website */}
                      <td className="py-3.5 px-4 font-sans">
                        <div className="font-semibold text-slate-800">{d.websiteSlug}</div>
                        {targetWeb && (
                          <div className="text-[10px] text-slate-400 flex items-center gap-1">
                            <span className="uppercase">{targetWeb.runtime}</span> &bull; <span>{targetWeb.webServer}</span>
                          </div>
                        )}
                      </td>

                      {/* SSL Status */}
                      <td className="py-3.5 px-4">
                        {d.sslEnabled ? (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <ShieldCheck className="w-3 h-3 text-emerald-600" />
                            <span className="capitalize">{d.sslProvider.replace('_', ' ')}</span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                            <ShieldAlert className="w-3 h-3 text-slate-400" />
                            <span>No SSL</span>
                          </div>
                        )}
                      </td>

                      {/* Policy Toggles */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleToggleSettings(d, 'forceHTTPS', !d.forceHttps)}
                            disabled={!d.sslEnabled}
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                              d.forceHttps 
                                ? 'bg-blue-50 text-blue-700 border border-blue-200' 
                                : 'bg-slate-100 text-slate-400 border border-slate-200 line-through'
                            } disabled:opacity-30 disabled:cursor-not-allowed`}
                            title={d.sslEnabled ? "Toggle 301 Force HTTPS" : "Enable SSL first"}
                          >
                            {d.forceHttps ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                            <span>HTTPS</span>
                          </button>

                          {d.hstsEnabled && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                              HSTS
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Expiry & Issuer */}
                      <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                        {d.sslExpiresAt ? (
                          <div>
                            <div className={`font-medium ${isExpiringSoon ? 'text-amber-600 font-bold' : 'text-slate-700'}`}>
                              {new Date(d.sslExpiresAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                            </div>
                            <div className="text-[10px] text-slate-400 truncate max-w-[140px]" title={d.sslIssuer}>
                              {d.sslIssuer || 'Standard Authority'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-[10px] italic">Not configured</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openSSLModal(d)}
                            className="px-2.5 py-1 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <Lock className="w-3 h-3" />
                            <span>{d.sslEnabled ? 'Manage SSL' : 'Enable SSL'}</span>
                          </button>

                          {!d.isPrimary && (
                            <button
                              onClick={() => setShowDeleteModal(d)}
                              className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                              title="Delete alias domain"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- ADD DOMAIN ALIAS MODAL --- */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Add Domain Alias</h3>
                  <p className="text-xs text-slate-500">Route an additional hostname to a website</p>
                </div>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddDomain} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Target Website
                </label>
                <select
                  value={addWebsiteSlug}
                  onChange={(e) => setAddWebsiteSlug(e.target.value)}
                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-800 focus:outline-hidden focus:border-blue-500"
                >
                  {websites.map((w) => (
                    <option key={w.slug} value={w.slug}>
                      {w.slug} ({w.domain})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Domain Name (FQDN)
                </label>
                <input
                  type="text"
                  placeholder="e.g. blog.example.com or api.domain.org"
                  value={addDomainName}
                  onChange={(e) => setAddDomainName(e.target.value)}
                  className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-hidden focus:border-blue-500"
                  required
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Point this domain's DNS A/CNAME record to this server before issuing Let's Encrypt certificates.
                </p>
              </div>

              <div className="bg-blue-50/70 border border-blue-100 rounded-xl p-3 flex items-start gap-2.5 text-xs text-blue-900">
                <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  BarePod will automatically re-render and reload the active web server virtual host configuration without downtime.
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addLoading}
                  className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  {addLoading && <RefreshCw className="w-3 h-3 animate-spin" />}
                  <span>Attach Domain</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MANAGE SSL MODAL --- */}
      {selectedDomain && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">SSL / TLS Certificate Manager</h3>
                  <p className="text-xs font-mono text-blue-600">{selectedDomain.domain}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedDomain(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tab Navigation */}
            <div className="flex border-b border-slate-100 px-5 pt-2 bg-slate-50/50">
              <button
                onClick={() => setSslTab('auto')}
                className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                  sslTab === 'auto'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Automated / Let's Encrypt</span>
              </button>

              <button
                onClick={() => setSslTab('custom')}
                className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                  sslTab === 'custom'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Key className="w-3.5 h-3.5" />
                <span>Custom Keypair</span>
              </button>
            </div>

            <div className="p-5 space-y-4">
              {sslTab === 'auto' ? (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Issuance Provider
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setSslProvider('auto')}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          sslProvider === 'auto'
                            ? 'border-blue-500 bg-blue-50/50 text-blue-900 ring-2 ring-blue-500/20'
                            : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="text-xs font-bold flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                          <span>Let's Encrypt (Auto)</span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          Public CA with automatic 90-day renewals.
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSslProvider('self_signed')}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          sslProvider === 'self_signed'
                            ? 'border-purple-500 bg-purple-50/50 text-purple-900 ring-2 ring-purple-500/20'
                            : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="text-xs font-bold flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5 text-purple-600" />
                          <span>Self-Signed (Local)</span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          Instant ECDSA P-256 for local dev or staging.
                        </div>
                      </button>
                    </div>
                  </div>

                  {sslProvider !== 'self_signed' && (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Notification Email (Optional)
                      </label>
                      <input
                        type="email"
                        placeholder="admin@example.com"
                        value={sslEmail}
                        onChange={(e) => setSslEmail(e.target.value)}
                        className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-hidden focus:border-blue-500"
                      />
                    </div>
                  )}

                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80 space-y-2.5">
                    <div className="text-xs font-bold text-slate-800">Security & Redirection Policy</div>
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sslForceHttps}
                        onChange={(e) => setSslForceHttps(e.target.checked)}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-xs font-medium text-slate-700">
                        Force HTTPS (HTTP 301 Permanent Redirect)
                      </span>
                    </label>

                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sslHsts}
                        onChange={(e) => setSslHsts(e.target.checked)}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-xs font-medium text-slate-700">
                        Enable HSTS Header (Strict-Transport-Security)
                      </span>
                    </label>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setSelectedDomain(null)}
                      className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleIssueSSL}
                      disabled={sslLoading}
                      className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {sslLoading && <RefreshCw className="w-3 h-3 animate-spin" />}
                      <span>Issue & Install Certificate</span>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Certificate (PEM Format)
                    </label>
                    <textarea
                      rows={5}
                      placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                      value={customCert}
                      onChange={(e) => setCustomCert(e.target.value)}
                      className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 focus:outline-hidden focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Private Key (PEM Format)
                    </label>
                    <textarea
                      rows={5}
                      placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                      value={customKey}
                      onChange={(e) => setCustomKey(e.target.value)}
                      className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 focus:outline-hidden focus:border-blue-500"
                    />
                  </div>

                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80 space-y-2.5">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sslForceHttps}
                        onChange={(e) => setSslForceHttps(e.target.checked)}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-xs font-medium text-slate-700">
                        Force HTTPS (HTTP 301 Permanent Redirect)
                      </span>
                    </label>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setSelectedDomain(null)}
                      className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleUploadCustomSSL}
                      disabled={sslLoading}
                      className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {sslLoading && <RefreshCw className="w-3 h-3 animate-spin" />}
                      <span>Validate & Install Custom SSL</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- CONFIRM DELETE MODAL --- */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Remove Domain Alias</h3>
                <p className="text-xs text-slate-500">This action cannot be undone</p>
              </div>
            </div>

            <p className="text-xs text-slate-600">
              Are you sure you want to remove alias <span className="font-bold font-mono text-slate-900">'{showDeleteModal.domain}'</span> from website <span className="font-bold text-slate-900">{showDeleteModal.websiteSlug}</span>?
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteDomain}
                className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors shadow-sm cursor-pointer"
              >
                Remove Alias
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
