import React, { useEffect, useState, useRef } from 'react';
import { Check, Loader2, RefreshCw, Sparkles, Download, Terminal, CheckCircle2, AlertCircle, X } from 'lucide-react';
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

  // Live streaming modal state for installing missing extensions
  const [showLogModal, setShowLogModal] = useState(false);
  const [jobStatus, setJobStatus] = useState<'running' | 'success' | 'failed' | null>(null);
  const [jobLogs, setJobLogs] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const jobSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (showLogModal && jobLogs.length > 0) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [jobLogs.length, showLogModal]);

  useEffect(() => {
    return () => {
      jobSourceRef.current?.close();
    };
  }, []);

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

  const handleInstallMissing = async () => {
    setInstallingMissing(true);
    setJobLogs([`Requesting installation of missing extensions for PHP ${version}...`]);
    setJobStatus('running');
    setShowLogModal(true);

    try {
      const res = await api.installPhpExtensions(version);
      const source = new EventSource(api.stackJobStreamUrl(res.jobId), { withCredentials: true });
      jobSourceRef.current = source;

      source.addEventListener('log', (event) => {
        try {
          const frame = JSON.parse((event as MessageEvent).data);
          if (frame?.line) {
            setJobLogs((prev) => [...prev, frame.line]);
          }
        } catch {
          // ignore malformed frame
        }
      });

      source.addEventListener('done', (event) => {
        try {
          const doneData = JSON.parse((event as MessageEvent).data);
          const st = doneData.status === 'success' ? 'success' : 'failed';
          setJobStatus(st);
          if (st === 'success') {
            onShowToast?.(
              'Extensions Installed',
              `All PHP ${version} extensions installed and enabled successfully!`,
              'success',
            );
          } else {
            onShowToast?.(
              'Installation Finished',
              'Process completed. Review terminal logs for details.',
              'info',
            );
          }
        } catch {
          setJobStatus('success');
        }
        source.close();
        jobSourceRef.current = null;
        setInstallingMissing(false);
        void load();
      });

      source.onerror = () => {
        source.close();
        jobSourceRef.current = null;
        setInstallingMissing(false);
        void load();
      };
    } catch (err) {
      onShowToast?.('Could not start extension installation', describeError(err), 'error');
      setInstallingMissing(false);
      setJobStatus('failed');
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
            onClick={handleInstallMissing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg text-xs transition-colors shadow-2xs cursor-pointer shrink-0 disabled:opacity-50"
          >
            {installingMissing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>{installingMissing ? 'Installing...' : 'Install Missing Extensions'}</span>
          </button>
        </div>
      )}

      {/* Live Stream Terminal Modal */}
      {showLogModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full p-5 space-y-3 text-xs text-slate-200 flex flex-col max-h-[85dvh]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 shrink-0">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Terminal className="w-4 h-4 text-purple-400" />
                <span>Installing PHP {version} Extensions</span>
              </div>
              <div className="flex items-center gap-2">
                {jobStatus === 'running' && (
                  <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-purple-950 text-purple-300 border border-purple-800 animate-pulse">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Running apt...
                  </span>
                )}
                {jobStatus === 'success' && (
                  <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                    <CheckCircle2 className="w-3 h-3" />
                    Complete
                  </span>
                )}
                {jobStatus === 'failed' && (
                  <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-950 text-rose-300 border border-rose-800">
                    <AlertCircle className="w-3 h-3" />
                    Failed
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setShowLogModal(false)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-black/60 rounded-xl p-3.5 border border-slate-800/80 font-mono text-[11px] leading-relaxed text-slate-300 space-y-1 shadow-inner select-text min-h-[220px]">
              {jobLogs.length === 0 ? (
                <div className="flex items-center gap-2 text-slate-500 py-6 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                  <span>Connecting to background installation task...</span>
                </div>
              ) : (
                jobLogs.map((line, idx) => (
                  <div key={idx} className="whitespace-pre-wrap break-all text-slate-300 font-mono">
                    {line}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800 shrink-0 text-slate-400 text-[11px]">
              <span>
                {jobStatus === 'running'
                  ? 'Task is running in background. You can close this window at any time.'
                  : 'Installation finished. Extension statuses have been updated.'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowLogModal(false);
                  void load();
                }}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-semibold transition-colors cursor-pointer text-xs"
              >
                {jobStatus === 'running' ? 'Keep Running in Background' : 'Done'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
