/**
 * What an address actually is, rather than what a label would like it to be: 172.19.1.26 is a
 * private address (RFC1918), and calling it a "public IP" tells the operator something false about
 * who can reach it. 100.64/10 is carrier-grade NAT, which is private in every sense that matters.
 */
export function describeAddress(address: string): { label: string; tone: 'loopback' | 'private' | 'public' | 'none' } {
  const value = (address || '').trim();
  if (!value) return { label: 'unknown', tone: 'none' };
  if (/^(localhost|::1)$/i.test(value)) return { label: 'Loopback only', tone: 'loopback' };
  const octets = value.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return { label: 'Hostname', tone: 'public' };
  }
  const [first, second] = octets;
  if (first === 127) return { label: 'Loopback only', tone: 'loopback' };
  const privateRange =
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    (first === 100 && second >= 64 && second <= 127);
  return privateRange ? { label: 'Private', tone: 'private' } : { label: 'Public', tone: 'public' };
}

/**
 * The scheme a site is really reachable on: https only when the panel issued a certificate or the
 * site is published through a Cloudflare tunnel (which terminates TLS). A plain site is http.
 */
export const siteUrl = (app: { domain: string; ssl?: boolean; tunnelEnabled?: boolean }): string =>
  `${app.ssl || app.tunnelEnabled ? 'https' : 'http'}://${app.domain}`;
