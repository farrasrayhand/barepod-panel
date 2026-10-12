/**
 * Saving a file the panel sent.
 *
 * Deliberately not an `<a href download>` or a redirect: the browser's download path runs on
 * its own network stack, which refuses to do anything at all on an origin whose certificate
 * the user had to click past — the page works, the download fails with "Failed - Network
 * error". Handing the bytes over from a request the page itself made avoids that entirely, and
 * is what every download in the panel now does.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next tick: revoking immediately can cancel the save in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The API failure message, for a toast. */
export function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
