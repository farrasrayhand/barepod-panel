import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Terminal, X, XCircle } from 'lucide-react';
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
 * A deploy is asynchronous — `POST /websites` answers 202 and provisions in the
 * background — so a toast saying "started" is all a screen can honestly say without
 * this. The lines are the daemon's (each step, each command, stdout/stderr) and the
 * last frame carries the final job, so what is shown is what happened, not a guess.
 */
export const DeployLogPanel: React.FC<DeployLogPanelProps> = ({ slug, deployId, onClose, onFinished }) => {
  const [lines, setLines] = useState<DeployLogLine[]>([]);
  const [job, setJob] = useState<DeployJob | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  // The callback lives in a ref: an inline arrow from the caller changes identity on
  // every render, and depending on it would tear the stream down and re-subscribe
  // (replaying the log) on each one.
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
      },
    );
    return stop;
  }, [slug, deployId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  const failed = job?.status === 'failed';
  const running = !job || job.status === 'pending' || job.status === 'running';
  const step = lines.filter((line) => line.stream === 'step' || line.stream === 'status').length;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(42rem,92vw)] bg-slate-900 text-slate-100 rounded-xl shadow-2xl border border-slate-700 flex flex-col max-h-[70vh]">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-700">
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="text-xs font-semibold truncate">Deploying {slug}</span>
          {step > 0 && <span className="text-[10px] text-slate-400">step {step}{job ? `/${job.totalSteps}` : ''}</span>}
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
            {job?.mode === 'dry-run' ? 'dry-run' : 'live'}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {running && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />}
          {job?.status === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          {failed && <XCircle className="w-4 h-4 text-red-400" />}
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100 cursor-pointer" title="Hide">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed space-y-0.5">
        {lines.length === 0 && <p className="text-slate-500">Waiting for the daemon…</p>}
        {lines.map((line) => (
          <p
            key={line.id}
            className={
              line.stream === 'stderr'
                ? 'text-red-300'
                : line.stream === 'step' || line.stream === 'status'
                  ? 'text-blue-300'
                  : 'text-slate-300'
            }
          >
            {line.stream === 'step' || line.stream === 'status' ? '» ' : ''}
            {line.line}
          </p>
        ))}
        <div ref={endRef} />
      </div>

      <div className="px-4 py-2 border-t border-slate-700 text-[11px]">
        {running && <span className="text-slate-400">Provisioning runs on the daemon; the site is live when this finishes.</span>}
        {job?.status === 'success' && <span className="text-emerald-400">Deployed. The website is live.</span>}
        {failed && <span className="text-red-400">Failed — the lines above are the daemon's own reason. Nothing was left half-started.</span>}
      </div>
    </div>
  );
};
