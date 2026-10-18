import React, { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, Copy, Loader2, Maximize2, Minus, Terminal, X, XCircle } from 'lucide-react';
import { subscribeDeploy, type DeployJob, type DeployLogLine } from '../api/client';

interface DeployLogPanelProps {
  /** The website being deployed; the stream is its own (`/websites/:slug/deploy/stream`). */
  slug: string;
  deployId?: string;
  onClose: () => void;
  /** The daemon's final word: a job with success/failed, so the caller can refresh. */
  onFinished?: (job: DeployJob) => void;
}

/**
 * The deploy's own log, streamed from the daemon.
 *
 * Supports real-time streaming, minimizing into a compact capsule,
 * and auto-dismissing after a successful deployment.
 */
export const DeployLogPanel: React.FC<DeployLogPanelProps> = ({ slug, deployId, onClose, onFinished }) => {
  const [lines, setLines] = useState<DeployLogLine[]>([]);
  const [job, setJob] = useState<DeployJob | null>(null);
  const [copied, setCopied] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [autoCloseSeconds, setAutoCloseSeconds] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [keepOpen, setKeepOpen] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const finished = useRef(onFinished);
  finished.current = onFinished;

  useEffect(() => {
    const stop = subscribeDeploy(
      slug,
      deployId,
      (line) => setLines((previous) => [...previous, line]),
      (final) => {
        setJob(final);
        finished.current?.(final);
        // Start auto-dismiss countdown if deploy succeeded
        if (final.status === 'success') {
          setAutoCloseSeconds(5);
        }
      },
    );
    return stop;
  }, [slug, deployId]);

  // Handle auto-dismiss countdown (pauses on hover)
  useEffect(() => {
    if (autoCloseSeconds === null || keepOpen || isPaused) return;

    if (autoCloseSeconds <= 0) {
      onClose();
      return;
    }

    const timer = setTimeout(() => {
      setAutoCloseSeconds((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);

    return () => clearTimeout(timer);
  }, [autoCloseSeconds, keepOpen, isPaused, onClose]);

  useEffect(() => {
    if (!isMinimized) {
      endRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [lines, isMinimized]);

  const handleCopyLogs = () => {
    const text = lines.map((l) => l.line).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setKeepOpen(true); // Keep open if user copied logs
    setTimeout(() => setCopied(false), 2000);
  };

  const failed = job?.status === 'failed';
  const running = !job || job.status === 'pending' || job.status === 'running';
  const step = lines.filter((line) => line.stream === 'step' || line.stream === 'status').length;

  // Minimized Compact Pill
  if (isMinimized) {
    return (
      <div
        onClick={() => setIsMinimized(false)}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        className="fixed bottom-4 right-4 z-50 bg-slate-900/95 text-slate-100 rounded-full shadow-2xl border border-slate-700/80 px-4 py-2.5 flex items-center gap-3 backdrop-blur-md cursor-pointer hover:border-slate-500 hover:bg-slate-900 transition-all duration-200 animate-in slide-in-from-bottom-2 group"
        title="Click to view full deploy log"
      >
        <Terminal className="w-4 h-4 text-slate-400 group-hover:text-blue-400 transition-colors" />
        <div className="flex items-center gap-2 text-xs font-semibold">
          {running && (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 shrink-0" />
              <span>Deploying <span className="font-mono text-blue-300">{slug}</span></span>
              {step > 0 && (
                <span className="text-[10px] text-slate-400 font-mono">
                  ({step}{job?.totalSteps ? `/${job.totalSteps}` : ''})
                </span>
              )}
            </>
          )}
          {job?.status === 'success' && (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-emerald-300 font-medium">Deployed {slug} (Live)</span>
              {autoCloseSeconds !== null && !keepOpen && (
                <span className="text-[10px] text-slate-400 font-mono">
                  ({autoCloseSeconds}s)
                </span>
              )}
            </>
          )}
          {failed && (
            <>
              <XCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span className="text-red-300 font-medium">Failed: {slug}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1 ml-1 border-l border-slate-700/80 pl-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setIsMinimized(false)}
            className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800 cursor-pointer transition-colors"
            title="Expand deploy log"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800 cursor-pointer transition-colors"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // Expanded Log Panel
  return (
    <div
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className="fixed bottom-4 right-4 z-50 w-[min(46rem,94vw)] bg-slate-900 text-slate-100 rounded-2xl shadow-2xl border border-slate-700/80 flex flex-col max-h-[75dvh] backdrop-blur-md animate-in slide-in-from-bottom-3 duration-200"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-700/80 bg-slate-950/50 rounded-t-2xl">
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="text-xs font-bold truncate">
            {running ? `Deploying ${slug}` : failed ? `Build Failed: ${slug}` : `Build Success: ${slug}`}
          </span>
          {step > 0 && (
            <span className="text-[10px] text-slate-400 font-mono">
              step {step}{job?.totalSteps ? `/${job.totalSteps}` : ''}
            </span>
          )}
          <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700">
            {job?.mode === 'dry-run' ? 'dry-run' : 'live'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {lines.length > 0 && (
            <button
              onClick={handleCopyLogs}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-100 px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-800 border border-slate-700 cursor-pointer transition-colors"
              title="Copy all logs to clipboard"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          )}
          {running && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />}
          {job?.status === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          {failed && <XCircle className="w-4 h-4 text-red-400" />}

          {/* Minimize Button */}
          <button
            onClick={() => setIsMinimized(true)}
            className="text-slate-400 hover:text-slate-100 p-1 rounded hover:bg-slate-800 cursor-pointer transition-colors"
            title="Minimize log panel"
          >
            <Minus className="w-4 h-4" />
          </button>

          {/* Close Button */}
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 p-1 rounded hover:bg-slate-800 cursor-pointer transition-colors"
            title="Close Panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed space-y-1">
        {lines.length === 0 && (
          <p className="text-slate-500 py-4 text-center">
            {failed && job?.error
              ? `[FAIL] ${job.error}`
              : running
                ? 'Waiting for deployment stream output…'
                : 'No build output recorded for this deployment.'}
          </p>
        )}
        {lines.map((line) => (
          <p
            key={line.id}
            className={
              line.stream === 'stderr'
                ? 'text-red-300'
                : line.stream === 'step' || line.stream === 'status'
                  ? 'text-blue-300 font-semibold'
                  : 'text-slate-300'
            }
          >
            {line.stream === 'step' || line.stream === 'status' ? '» ' : ''}
            {line.line}
          </p>
        ))}
        {failed && job?.error && !lines.some((l) => l.line.includes(job.error!)) && (
          <p className="text-red-400 font-bold mt-2">
            » [FAIL] {job.error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <div className="px-4 py-2.5 border-t border-slate-700/80 bg-slate-950/40 rounded-b-2xl text-[11px] flex items-center justify-between">
        <div className="truncate flex items-center gap-2">
          {running && <span className="text-slate-400">Provisioning runs on the daemon; the site is live when this finishes.</span>}
          {job?.status === 'success' && (
            <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
              <span>✓ Deployed. The website is live.</span>
              {autoCloseSeconds !== null && !keepOpen && (
                <span className="text-slate-400 font-normal text-[10px]">
                  (auto-closing in {autoCloseSeconds}s
                  {isPaused ? ' - paused' : ''} •{' '}
                  <button
                    onClick={() => setKeepOpen(true)}
                    className="text-blue-400 hover:text-blue-300 underline cursor-pointer"
                  >
                    keep open
                  </button>
                  )
                </span>
              )}
            </span>
          )}
          {failed && <span className="text-red-400 font-semibold">✗ Failed: {job?.error || "See the log above for the daemon's reason."}</span>}
        </div>
        <button
          onClick={onClose}
          className="text-xs text-slate-400 hover:text-slate-200 px-2 py-0.5 rounded cursor-pointer shrink-0"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
};
