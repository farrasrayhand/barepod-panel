import { useCallback, useEffect, useState } from 'react';
import { api, type PublicIPInfo } from '../api/client';

/**
 * The server's public address, shared by the sidebar, settings and DNS cards.
 * The backend caches it for five minutes; pass refresh=true to force a probe.
 */
export function usePublicIP(auto = true) {
  const [info, setInfo] = useState<PublicIPInfo | null>(null);
  const [loading, setLoading] = useState(auto);
  const [error, setError] = useState('');

  const refresh = useCallback(async (force = true) => {
    setLoading(true);
    setError('');
    try {
      const next = await api.publicIP(force);
      setInfo(next);
      if (next.stale && next.message) setError(next.message);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not detect the public IP');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (auto) void refresh(false);
  }, [auto, refresh]);

  return { info, ip: info?.ip ?? '', loading, error, refresh };
}
