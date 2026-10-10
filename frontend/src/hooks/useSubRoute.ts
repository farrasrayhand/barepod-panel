import { useCallback, useEffect, useState } from 'react';

const currentSegments = () => window.location.pathname.split('/').filter(Boolean);

/**
 * Persists a view's active tab in the URL as `/<menu>/<sub>` so that refresh and
 * browser back/forward restore the same tab (like the app detail sub-tabs).
 */
export function useSubRoute<T extends string>(fallback: T): [T, (next: T) => void] {
  const read = (): T => (currentSegments()[1] as T) ?? fallback;

  const [sub, setSub] = useState<T>(read);

  useEffect(() => {
    const onPop = () => setSub(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = useCallback((next: T) => {
    const menu = currentSegments()[0];
    const path = `/${menu}/${next}`;
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
    setSub(next);
  }, []);

  return [sub, select];
}
