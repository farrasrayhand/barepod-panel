/**
 * What a website actually has, by its type.
 *
 * The "Reverse Proxy Only" and "Static HTML" choices are not applications: a
 * proxy just forwards traffic to an upstream (its process runs in that pod), and
 * a static site has no runtime. Offering them a shell or a runtime-scoped file
 * manager would be dishonest, so the UI asks these helpers first.
 */
import type { WebApp } from '../types';

/** True when the site runs its own process, so a shell means something. */
export function siteSupportsShell(app: WebApp): boolean {
  return app.runtime !== 'proxy';
}

/** True when the site has a docroot of its own to manage. */
export function siteSupportsFiles(app: WebApp): boolean {
  return app.runtime !== 'proxy';
}

/** Why the shell is unavailable — shown as a tooltip, never left unexplained. */
export function siteShellNote(app: WebApp): string {
  if (siteSupportsShell(app)) return 'Open a shell in this website';
  return 'A reverse proxy only forwards traffic — the process lives in the upstream container, so open the shell there instead.';
}

/** Why the file manager is unavailable. */
export function siteFilesNote(app: WebApp): string {
  if (siteSupportsFiles(app)) return 'Browse this website\u2019s files';
  return 'A reverse proxy has no docroot of its own; its files live in the upstream container.';
}
