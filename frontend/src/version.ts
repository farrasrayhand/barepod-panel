/**
 * The panel version — one source of truth.
 *
 * Versioning policy (see MASTER_PLAN §0): the number only moves when a milestone
 * is *completed*, never because a commit landed. While the project is a
 * prototype it stays in the 0.x line, and the UI shows the **daemon's** version
 * when one is running (`GET /health`), falling back to this constant in
 * offline state.
 */
export const PANEL_VERSION = '0.4.2';

/** Short label for the UI: "v0.3.4". */
export const PANEL_VERSION_LABEL = `v${PANEL_VERSION}`;

/**
 * Compares two semantic version strings and returns true if remote is strictly newer than current.
 */
export function isNewerVersion(remote?: string, current?: string): boolean {
  if (!remote || !current) return false;
  const rClean = remote.replace(/^v/, '').split('-')[0].trim();
  const cClean = current.replace(/^v/, '').split('-')[0].trim();
  if (rClean === cClean) return false;

  const rParts = rClean.split('.').map((p) => parseInt(p, 10) || 0);
  const cParts = cClean.split('.').map((p) => parseInt(p, 10) || 0);
  const maxLen = Math.max(rParts.length, cParts.length);
  for (let i = 0; i < maxLen; i++) {
    const r = rParts[i] ?? 0;
    const c = cParts[i] ?? 0;
    if (r > c) return true;
    if (r < c) return false;
  }
  return false;
}
