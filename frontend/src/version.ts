/**
 * The panel version — one source of truth.
 *
 * Versioning policy (see MASTER_PLAN §0): the number only moves when a milestone
 * is *completed*, never because a commit landed. While the project is a
 * prototype it stays in the 0.x line, and the UI shows the **daemon's** version
 * when one is running (`GET /health`), falling back to this constant in
 * simulation mode.
 */
export const PANEL_VERSION = '0.3.3';

/** Short label for the UI: "v0.3.3". */
export const PANEL_VERSION_LABEL = `v${PANEL_VERSION}`;
