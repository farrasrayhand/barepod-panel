import React from 'react';
import { Server } from 'lucide-react';
import { LiveTerminal } from './LiveTerminal';

interface HostConsoleProps {
  hostname?: string;
}

export const HostConsole: React.FC<HostConsoleProps> = ({ hostname = 'barepod' }) => {
  return (
    <div className="space-y-4">
      {/* Root Host Console Banner */}
      <div className="p-4 rounded-xl bg-white border border-slate-200 text-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-purple-50 text-purple-700 border border-purple-200 shrink-0">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900 tracking-tight">Interactive Host Root Terminal (PTY)</h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 font-mono">
                ROOT PRIVILEGES
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Direct WebSocket pseudo-terminal connected to <strong className="text-slate-800 font-mono">{hostname}</strong>. Runs with host daemon privileges without tenant jailing.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 text-[11px] font-mono text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>WebSocket PTY (raw binary I/O)</span>
        </div>
      </div>

      {/* Terminal Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-5">
        <LiveTerminal
          title={`root@${hostname}`}
          subtitle="host pseudo-terminal session"
          isHost={true}
          showSizeControl={true}
        />
      </div>
    </div>
  );
};
