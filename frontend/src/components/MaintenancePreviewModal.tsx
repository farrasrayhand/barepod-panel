import React, { useState } from 'react';
import { X, AlertTriangle, RefreshCw, Shield, Globe, Laptop, Smartphone } from 'lucide-react';

interface MaintenancePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  domain: string;
  appName: string;
  message?: string;
  bypassIps?: string;
}

export const MaintenancePreviewModal: React.FC<MaintenancePreviewModalProps> = ({
  isOpen,
  onClose,
  domain,
  appName,
  message,
  bypassIps,
}) => {
  const [deviceView, setDeviceView] = useState<'desktop' | 'mobile'>('desktop');
  const [simulateBypass, setSimulateBypass] = useState(false);

  if (!isOpen) return null;

  const displayMessage = message?.trim() || 
    'We are performing scheduled infrastructure maintenance and system updates. Service will be back online shortly.';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        
        {/* Modal Window Top Bar */}
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-3 h-3 rounded-full bg-rose-500/80" />
            <div className="w-3 h-3 rounded-full bg-amber-500/80" />
            <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
            <span className="text-xs font-mono font-medium text-slate-300 ml-2">
              Simulator HTTP 503 Maintenance Page: {domain}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Device Switcher */}
            <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700">
              <button
                onClick={() => setDeviceView('desktop')}
                className={`p-1.5 rounded text-xs transition-colors ${
                  deviceView === 'desktop' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Desktop View"
              >
                <Laptop className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setDeviceView('mobile')}
                className={`p-1.5 rounded text-xs transition-colors ${
                  deviceView === 'mobile' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Mobile View"
              >
                <Smartphone className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Simulate Bypass IP Toggle */}
            <label className="flex items-center gap-1.5 text-xs text-slate-300 bg-slate-800/80 px-2.5 py-1.5 rounded-lg border border-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={simulateBypass}
                onChange={(e) => setSimulateBypass(e.target.checked)}
                className="w-3.5 h-3.5 rounded text-blue-500"
              />
              <span className="text-[11px] font-medium">Test IP Whitelist Bypass</span>
            </label>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Browser Mock Navigation Bar */}
        <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1 text-slate-400">
            <Globe className="w-3.5 h-3.5" />
          </div>
          <div className="flex-1 bg-white border border-slate-200 rounded-md px-3 py-1 font-mono text-[11px] text-slate-700 flex items-center justify-between">
            <span>https://{domain}</span>
            {simulateBypass ? (
              <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                200 OK (IP Bypass Active)
              </span>
            ) : (
              <span className="text-[10px] text-amber-700 font-bold bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                503 Service Unavailable
              </span>
            )}
          </div>
          <button 
            onClick={() => {}}
            className="p-1 text-slate-500 hover:text-slate-800 rounded hover:bg-slate-200"
            title="Reload"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Browser Viewport */}
        <div className="flex-1 overflow-y-auto bg-slate-50 p-6 flex items-center justify-center">
          <div className={`transition-all duration-300 ${
            deviceView === 'mobile' 
              ? 'w-[360px] min-h-[580px] bg-white rounded-3xl border-8 border-slate-800 shadow-xl overflow-hidden flex flex-col' 
              : 'w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden'
          }`}>
            {simulateBypass ? (
              /* Whitelisted IP View (Site Appears Normally) */
              <div className="p-8 text-center space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto shadow-inner">
                  <Shield className="w-7 h-7" />
                </div>
                <div>
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 mb-2">
                    IP Whitelist Verified
                  </span>
                  <h3 className="text-xl font-bold text-slate-900">{appName} Active & Operational</h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                    Your connection comes from a whitelisted IP ({bypassIps || '127.0.0.1, 103.147.154.82'}), so you bypass the 503 maintenance page and reach the app normally.
                  </p>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-left font-mono text-[11px] text-slate-600 max-w-md mx-auto">
                  <p className="text-slate-400 font-sans text-[10px] mb-1 font-semibold uppercase">Simulated Web Application Body:</p>
                  <p>HTTP/2 200 OK</p>
                  <p>Server: BarePod High-Performance Web Engine</p>
                  <p>X-Maintenance-Bypass: Granted (Client IP matched)</p>
                </div>
              </div>
            ) : (
              /* Visitor HTTP 503 Maintenance Page */
              <div className="p-8 sm:p-12 text-center flex flex-col items-center justify-center space-y-6">
                <div className="relative">
                  <div className="w-20 h-20 rounded-3xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/10 animate-bounce duration-1000">
                    <AlertTriangle className="w-10 h-10" />
                  </div>
                  <span className="absolute -top-1 -right-2 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider bg-amber-500 text-white rounded-full shadow-xs">
                    HTTP 503
                  </span>
                </div>

                <div className="space-y-2 max-w-md">
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                    Under Scheduled Maintenance
                  </h2>
                  <p className="text-sm text-slate-600 leading-relaxed font-normal">
                    {displayMessage}
                  </p>
                </div>

                {/* Status Box */}
                <div className="w-full max-w-md p-4 rounded-xl bg-slate-50 border border-slate-200 text-left space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500 pb-2 border-b border-slate-200">
                    <span>Host / Target Domain</span>
                    <strong className="font-mono text-slate-800">{domain}</strong>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500 pb-2 border-b border-slate-200">
                    <span>Status Engine</span>
                    <span className="text-amber-700 font-bold flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                      503 Service Unavailable
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Retry-After</span>
                    <span className="font-mono text-slate-700 font-semibold">300 seconds</span>
                  </div>
                </div>

                <div className="pt-2 text-center">
                  <p className="text-[11px] text-slate-400">
                    Powered by BarePod Panel Zero-Downtime Traffic Orchestrator
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-white border-t border-slate-200 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            This page is served directly by the web server (Nginx/Caddy/OpenLiteSpeed) without loading your PHP/Node.js/container runtime.
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
          >
            Close Preview
          </button>
        </div>

      </div>
    </div>
  );
};
