import { useCallback, useEffect, useId, useRef } from 'react';

// Only one pinned tooltip at a time across all charts. Module-level (not
// context) because charts can be scattered with no common provider, and their
// onClick stopPropagation hides cross-chart clicks from Mantine's click-outside.
const pinnedTooltipRegistry = new Map<string, () => void>();

function broadcastTooltipPinned(activeId: string) {
  pinnedTooltipRegistry.forEach((dismiss, id) => {
    if (id !== activeId) {
      dismiss();
    }
  });
}

// Registers this chart's dismiss handler and returns a callback to close every
// other chart's pinned tooltip (call it when pinning this one).
export function useCrossChartPinDismiss(onDismiss: () => void): () => void {
  const id = useId();
  // Keep the latest onDismiss without re-subscribing each render.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    pinnedTooltipRegistry.set(id, () => onDismissRef.current());
    return () => {
      pinnedTooltipRegistry.delete(id);
    };
  }, [id]);

  return useCallback(() => broadcastTooltipPinned(id), [id]);
}
