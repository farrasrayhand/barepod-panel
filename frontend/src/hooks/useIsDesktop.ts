import { useEffect, useState } from 'react';

/**
 * The breakpoint below which the sidebar becomes an overlay drawer instead of a column.
 * It matches Tailwind's `lg` (1024px), which is what the shell's classes use — one value,
 * so the CSS and the behaviour cannot disagree about where the line is.
 */
const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * Whether the viewport is at the desktop breakpoint. The app shell uses it to decide what
 * the header's menu button does: open the drawer on a phone or tablet, collapse the column
 * on a desktop — the same button, two different things, because the sidebar is two
 * different things at those sizes.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window === 'undefined' || window.matchMedia(DESKTOP_QUERY).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(query.matches);
    // Re-read on mount: the initial state was taken before React hydrated the effect, and a
    // resize between the two would otherwise leave the button doing the wrong thing.
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}
