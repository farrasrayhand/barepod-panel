import React from 'react';
import { Heart } from 'lucide-react';
import { SiGithub } from 'react-icons/si';
import { PANEL_VERSION_LABEL } from '../version';

interface FooterProps {
  /** Version reported by the daemon; falls back to the panel constant. */
  daemonVersion?: string;
}

export const Footer: React.FC<FooterProps> = ({ daemonVersion }) => {
  // The panel is still a prototype: 0.x only, and it never pretends to be a
  // release. When the daemon answers, its version wins so the two cannot drift.
  const label = daemonVersion ? (daemonVersion.startsWith('v') ? daemonVersion : `v${daemonVersion}`) : PANEL_VERSION_LABEL;

  return (
    <footer className="mt-8 border-t border-slate-200 px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-400">
      <div className="flex items-center gap-2 flex-wrap justify-center">
        <span className="font-semibold text-slate-500">BarePod Panel</span>
        <span>·</span>
        <span className="font-mono">{label}</span>
        <span>·</span>
        <span className="inline-flex items-center gap-1">
          100% free hobby project <Heart className="w-3 h-3 text-rose-400" /> MIT
        </span>
      </div>

      <div className="flex items-center gap-3 flex-wrap justify-center">
        <span className="font-mono">amd64 · arm64 · LXC</span>
        <a
          href="https://github.com/farrasrayhand/barepod-panel"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:text-slate-600 transition-colors"
        >
          <SiGithub className="w-3.5 h-3.5" />
          <span>GitHub</span>
        </a>
      </div>
    </footer>
  );
};
