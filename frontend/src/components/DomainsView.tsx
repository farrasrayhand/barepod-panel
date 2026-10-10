import React, { useState } from 'react';
import { 
  Globe, 
  ShieldCheck, 
  Plus, 
  RefreshCw, 
  ExternalLink, 
  Check, 
  Lock, 
  AlertCircle, 
  Search,
  Server,
  CloudRain,
  ArrowUpRight
} from 'lucide-react';
import type { WebApp } from '../types';

interface DomainsViewProps {
  apps: WebApp[];
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
}

export const DomainsView: React.FC<DomainsViewProps> = ({ apps, onShowToast }) => {
  const [search, setSearch] = useState('');

  const domains = apps.map(app => ({
    id: app.id,
    domain: app.domain,
    appName: app.name,
    webServer: app.webServer,
    sslStatus: app.ssl ? 'active' : 'inactive',
    sslIssuer: "Let's Encrypt Authority X3",
    sslExpiry: '2026-12-10 (60 days left)',
    tunnelEnabled: app.tunnelEnabled,
    forceHttps: true,
    ip: '103.147.154.82'
  }));

  const filtered = domains.filter(d => 
    d.domain.toLowerCase().includes(search.toLowerCase()) || 
    d.appName.toLowerCase().includes(search.toLowerCase())
  );

  const handleRenewSsl = (domainName: string) => {
    onShowToast?.('SSL Certificate Renewed', `Sertifikat Let's Encrypt untuk ${domainName} berhasil diperbarui.`, 'success');
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Domains & SSL Certificates</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">
              Auto TLS
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Manajemen nama domain FQDN, status sertifikat Let's Encrypt SSL, dan rute DNS
          </p>
        </div>

        <button
          onClick={() => onShowToast?.('SSL Checked', 'Semua sertifikat SSL domain dalam keadaan valid dan aktif.', 'info')}
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors shadow-2xs cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
          <span>Check SSL Validity</span>
        </button>
      </div>

      {/* Domain List Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search domain or app..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 w-64 font-mono"
            />
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {filtered.length} Domains Configured
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px]">
              <tr>
                <th className="py-3 px-4">DOMAIN / FQDN</th>
                <th className="py-3 px-4">TARGET APPLICATION</th>
                <th className="py-3 px-4">WEB SERVER</th>
                <th className="py-3 px-4">SSL / TLS STATUS</th>
                <th className="py-3 px-4">EXPIRY & ISSUER</th>
                <th className="py-3 px-4 text-right">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {filtered.map(d => (
                <tr key={d.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-blue-600 shrink-0" />
                      <a
                        href={`https://${d.domain}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-bold text-slate-900 hover:text-blue-600 hover:underline flex items-center gap-1"
                      >
                        <span>{d.domain}</span>
                        <ArrowUpRight className="w-3 h-3 text-slate-400" />
                      </a>
                    </div>
                  </td>

                  <td className="py-3.5 px-4 font-sans">
                    <span className="font-semibold text-slate-800">{d.appName}</span>
                  </td>

                  <td className="py-3.5 px-4">
                    <span className="px-2 py-0.5 rounded font-bold uppercase text-[10px] bg-slate-100 text-slate-700">
                      {d.webServer}
                    </span>
                  </td>

                  <td className="py-3.5 px-4">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <ShieldCheck className="w-3 h-3" />
                      TLS 1.3 Active
                    </span>
                  </td>

                  <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                    <div>{d.sslExpiry}</div>
                    <div className="text-[10px] text-slate-400">{d.sslIssuer}</div>
                  </td>

                  <td className="py-3.5 px-4 text-right">
                    <button
                      onClick={() => handleRenewSsl(d.domain)}
                      className="px-2.5 py-1 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors cursor-pointer"
                    >
                      Renew SSL
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
