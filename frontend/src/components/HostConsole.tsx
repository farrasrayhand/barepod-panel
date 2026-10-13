import React from 'react';
import { Server } from 'lucide-react';
import { usePanelSize } from '../hooks/usePanelSize';
import { PanelSizeControl } from './PanelSizeControl';
import { LiveTerminal } from './LiveTerminal';

interface HostConsoleProps {
  hostname?: string;
}

export const HostConsole: React.FC<HostConsoleProps> = ({ hostname = 'barepod' }) => {
  const { size: termSize, height: termHeight, setSize: setTermSize } = usePanelSize({ sm: 320, md: 460, lg: 650 });

  return (
    <div className="space-y-4">
      {/* Root Host Console Banner */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30 shrink-0">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white tracking-tight">Interactive Host Root Terminal (PTY)</h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 font-mono">
                ROOT PRIVILEGES
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Direct WebSocket pseudo-terminal connected to <strong className="text-slate-200 font-mono">{hostname}</strong>. Runs with host daemon privileges without tenant jailing.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 text-[11px] font-mono text-slate-400 bg-slate-950/60 px-3 py-1.5 rounded-lg border border-slate-800">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>WebSocket PTY (raw binary I/O)</span>
        </div>
      </div>

      {/* Terminal Card */}
      <div className="bg-slate-950 rounded-2xl border border-slate-800 shadow-2xs overflow-hidden flex flex-col">
        <div className="p-4">
          <LiveTerminal
            title={`root@${hostname}`}
            subtitle="host pseudo-terminal session"
            isHost={true}
            height={termHeight}
          />
        </div>
        <PanelSizeControl value={termSize} onChange={setTermSize} dark />
      </div>
    </div>
  );
};
