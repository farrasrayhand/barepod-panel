import { useState } from 'react';

export type PanelSize = 'sm' | 'md' | 'lg';

/**
 * Fixed preset heights for panels so they can't be dragged to an absurd
 * length. Returns the active preset, its pixel height, and a setter.
 */
export function usePanelSize(sizes: Record<PanelSize, number>, initial: PanelSize = 'md') {
  const [size, setSize] = useState<PanelSize>(initial);
  return { size, height: sizes[size], setSize };
}
