import React, { useEffect, useState } from 'react';
import { Check, Loader2, RefreshCw, Sparkles, Download } from 'lucide-react';
import { api } from '../api/client';
import { describeError } from '../utils/format';

interface Extension {
  name: string;
  enabled: boolean;
}

interface PhpExtensionsPanelProps {
  version: string;
  title?: string;
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
  onCountChange?: (enabled: number, total: number) => void;
}

// PhpExtensionsPanel shows the extensions this host really has for a PHP version — the
// mods the packages installed and which of them are on — rather than a catalog kept in
// the frontend. The toggle runs phpenmod/phpdismod on the daemon, so what is drawn is
// what a shell would see.
export const PhpExtensionsPanel: React.FC<PhpExtensionsPanelProps> = ({ version, title, onShowToast, onCountChange }) => {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [installable, setInstallable] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [installingMissing, setInstallingMissing] = useState(false);
  const [search, setSearch] = useState('');

  const apply = (report: { extensions?: Extension[]; installable?: string[] }) => {
    const list = report.extensions ?? [];
    setExtensions(list);
    setInstallable(report.installable ?? []);
    onCountChange?.(list.filter((e) => e.enabled).length, list.length);
  };

  const load = async () => {
    if (!version) return;
    setLoading(true);
    try {
      apply(await api.phpExtensions(version));
    } catch (err) {
      onShowToast?.('Could not read the PHP extensions', describeError(err), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const toggle = async (name: string, enabled: boolean) => {
    setBusy(name);
    try {
      apply(await api.setPhpExtension(version, name, enabled));
      onShowToast?.(
        enabled ? 'Extension enabled' : 'Extension disabled',
        `${name} — ${enabled ? 'phpenmod' : 'phpdismod'} on PHP ${version}, pools reloaded.`,
        'success',
      );
    } catch (err) {
      onShowToast?.('Could not switch the extension', describeError(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!version) {
    return (
      <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-500">
        No PHP version to read extensions from — install one on the Stack page first.
      </div>
    );
  }

  const visible = extensions.filter((ext) => ext.name.includes(search.toLowerCase()));
  const enabledCount = extensions.filter((e) => e.enabled).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            {title ?? `PHP ${version} Extensions`} ({enabledCount} on / {extensions.length} on this host)
          </h3>
          <p className="text-[11px] text-slate-500">
            Read from this host: {extensions.length} installed for PHP {version}. Toggling runs phpenmod/phpdismod and reloads the pools.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search extensions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg w-40"
          />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
          </button>
        </div>
      </div>

      {extensions.length === 0 && !loading && (
        <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-500">
          This host has no PHP {version} extensions on record.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {visible.map((ext) => (
          <div
            key={ext.name}
            onClick={() => !busy && void toggle(ext.name, !ext.enabled)}
            className={`p-3 rounded-xl border text-xs cursor-pointer transition-all select-none ${
              ext.enabled ? 'bg-white border-purple-300 ring-1 ring-purple-400/20 shadow-2xs' : 'bg-slate-50 border-slate-200 opacity-60 hover:opacity-100'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="font-mono font-bold text-slate-900">{ext.name}</span>
                {busy === ext.name && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
              </div>
              <div
                className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${
                  ext.enabled ? 'bg-purple-600 border-purple-600 text-white' : 'border-slate-300 bg-white'
                }`}
              >
                {ext.enabled && <Check className="w-3 h-3 stroke-[3]" />}
              </div>
            </div>
          </div>
        ))}
      </div>

      {installable.length > 0 && (
        <div className="p-3.5 bg-purple-50/70 border border-purple-200/80 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div>
            <div className="font-bold text-slate-900 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-600" />
              <span>{installable.length} available extension{installable.length > 1 ? 's' : ''} not yet installed for PHP {version}</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Offered by host repository:{' '}
              <span className="font-mono text-purple-900 font-semibold">{installable.join(', ')}</span>
            </p>
          </div>
          <button
            type="button"
            disabled={installingMissing}
            onClick={async () => {
              setInstallingMissing(true);
              try {
                await api.installPhpExtensions(version);
                onShowToast?.(
                  'Installing Extensions',
                  `Started installing all missing extensions for PHP ${version} in the background. Check Stack page for live logs.`,
                  'info',
                );
                setTimeout(() => void load(), 3000);
              } catch (err) {
                onShowToast?.('Could not start extension installation', describeError(err), 'error');
              } finally {
                setInstallingMissing(false);
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg text-xs transition-colors shadow-2xs cursor-pointer shrink-0 disabled:opacity-50"
          >
            {installingMissing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>Install Missing Extensions</span>
          </button>
        </div>
      )}
    </div>
  );
};
