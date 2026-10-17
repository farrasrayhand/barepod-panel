import { useEffect, useRef, useState } from 'react';
import { Terminal as TerminalIcon, ShieldCheck, Server, AlertCircle } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api } from '../api/client';
import { usePanelSize } from '../hooks/usePanelSize';
import { PanelSizeControl } from './PanelSizeControl';

interface LiveTerminalProps {
  /** Website slug; omitted = host shell (administrators only). */
  slug?: string;
  title: string;
  subtitle?: string;
  isHost?: boolean;
  height?: number | string;
  showSizeControl?: boolean;
}

/**
 * Real terminal: a WebSocket to the daemon's PTY.
 *
 * Auth is a one-time ticket from POST /ws/ticket (30s, single use) — a session
 * token never appears in the URL. Binary frames are stdin/stdout, text frames are
 * control messages (`resize` uses pty.Setsize so vim/top fit the pane).
 */
export const LiveTerminal: React.FC<LiveTerminalProps> = ({ 
  slug, 
  title, 
  subtitle, 
  isHost, 
  height,
  showSizeControl = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed' | 'error'>('connecting');
  const [message, setMessage] = useState('Connecting…');
  const [identity, setIdentity] = useState('');
  const [mode, setMode] = useState('');

  const { size: termSize, height: defaultHeight, setSize: setTermSize } = usePanelSize({ sm: 320, md: 460, lg: 650 });
  const activeHeight = height ?? defaultHeight;

  useEffect(() => {
    let disposed = false;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12.5,
      theme: { background: '#0f172a', foreground: '#e2e8f0' },
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    termRef.current = term;
    fitRef.current = fit;

    if (containerRef.current) {
      term.open(containerRef.current);
      fit.fit();
    }

    (async () => {
      let ticket = '';
      try {
        const issued = await api.wsTicket();
        ticket = issued.ticket;
      } catch {
        if (!disposed) {
          setStatus('error');
          setMessage('Could not obtain a terminal ticket. Sign in again and retry.');
        }
        return;
      }
      if (disposed) return;

      const socket = new WebSocket(api.ptyUrl(ticket, slug));
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;

      socket.onopen = () => {
        setStatus('open');
        setMessage('');
        // Tell the server our initial size before the first output arrives.
        const size = { cols: term.cols, rows: term.rows };
        socket.send(JSON.stringify({ type: 'resize', ...size }));
      };

      socket.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const control = JSON.parse(event.data) as {
              type: string;
              user?: string;
              mode?: string;
              note?: string;
              message?: string;
              shell?: string;
              jailed?: boolean;
              masked?: number;
              jailMode?: string;
            };
            if (control.type === 'ready') {
              // Say whether the shell is confined: on a host without mount
              // namespaces it is not, and that changes what the tenant can reach.
              const confinement = !control.jailed
                ? 'not confined to this site'
                : control.jailMode === 'root'
                  ? 'jailed: this shell only contains the website'
                  : `confined to this site (${control.masked ?? 0} paths hidden)`;
              setIdentity(`${control.shell ?? 'shell'} · ${control.user ?? ''} · ${confinement}`.trim());
              setMode(control.mode ?? '');
              if (control.note) term.writeln(`\x1b[90m# ${control.note}\x1b[0m`);
            }
            if (control.type === 'error') {
              setStatus('error');
              setMessage(control.message ?? 'The terminal could not be started.');
            }
          } catch {
            term.write(event.data);
          }
          return;
        }
        term.write(new Uint8Array(event.data as ArrayBuffer));
      };

      socket.onclose = () => {
        setStatus((previous) => (previous === 'error' ? previous : 'closed'));
        setMessage((previous) => previous || 'Session closed.');
      };
      socket.onerror = () => {
        setStatus('error');
        setMessage('The terminal connection failed.');
      };

      term.onData((data) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(data));
      });
    })();

    // Keep the PTY in sync with the pane size.
    const onResize = () => {
      if (!fitRef.current || !termRef.current) return;
      fitRef.current.fit();
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols: termRef.current.cols, rows: termRef.current.rows }));
      }
    };
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      socketRef.current?.close();
      term.dispose();
    };
  }, [slug]);

  useEffect(() => {
    if (fitRef.current && termRef.current) {
      setTimeout(() => {
        fitRef.current?.fit();
        const socket = socketRef.current;
        if (socket?.readyState === WebSocket.OPEN && termRef.current) {
          socket.send(JSON.stringify({ type: 'resize', cols: termRef.current.cols, rows: termRef.current.rows }));
        }
      }, 50);
    }
  }, [activeHeight]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-800 border border-slate-200 flex items-center gap-1">
            {isHost ? <Server className="w-3.5 h-3.5 text-purple-600" /> : <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />}
            {isHost ? 'Host shell' : 'Tenant shell'}
          </span>
          <span className="text-sm font-semibold text-slate-800">{title}</span>
          {subtitle && <span className="text-xs text-slate-400 font-mono">{subtitle}</span>}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          {mode && <span className="px-2 py-0.5 rounded bg-slate-100 font-mono">{mode}</span>}
          {identity && <span className="font-mono">{identity}</span>}
          <span
            className={`px-2 py-0.5 rounded font-bold ${
              status === 'open'
                ? 'bg-emerald-100 text-emerald-700'
                : status === 'connecting'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-rose-100 text-rose-700'
            }`}
          >
            {status}
          </span>
        </div>
      </div>

      {message && (
        <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-slate-400" />
          <span>{message}</span>
        </div>
      )}

      {/* Terminal Screen Frame with Height Resize Controls */}
      <div className="w-full rounded-xl overflow-hidden border border-slate-800 shadow-2xs bg-[#0a0f1d] flex flex-col">
        <div
          ref={containerRef}
          className="w-full bg-[#0a0f1d] p-3"
          style={{ height: activeHeight }}
          onMouseDown={() => termRef.current?.focus()}
        />
        {showSizeControl && (
          <PanelSizeControl value={termSize} onChange={setTermSize} dark={true} />
        )}
      </div>

      <p className="text-[11px] text-slate-400 flex items-center gap-1.5 pt-0.5">
        <TerminalIcon className="w-3.5 h-3.5" />
        Binary frames carry stdin/stdout; the pane size is sent to the server so full-screen apps fit.
      </p>
    </div>
  );
};
