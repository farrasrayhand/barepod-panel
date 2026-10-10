import { useCallback, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

/**
 * Vertical drag-to-resize for panels: returns the current height and a
 * mousedown handler to attach to a drag handle.
 */
export function useResizableHeight(initial: number, min = 240, max = 1400) {
  const [height, setHeight] = useState(initial);
  const startRef = useRef<{ y: number; h: number } | null>(null);

  const onDragStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      startRef.current = { y: e.clientY, h: height };

      const onMove = (ev: MouseEvent) => {
        if (!startRef.current) return;
        const next = Math.min(max, Math.max(min, startRef.current.h + (ev.clientY - startRef.current.y)));
        setHeight(next);
      };
      const onUp = () => {
        startRef.current = null;
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [height, min, max],
  );

  return { height, onDragStart };
}
