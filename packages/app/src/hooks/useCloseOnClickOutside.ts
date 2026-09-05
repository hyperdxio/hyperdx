import { useEffect } from 'react';

import { useStableCallback } from './useStableCallback';

// Floating UI layers (drawers, modals, popovers, dropdowns, menus, tooltips,
// overlays) are frequently portaled to `document.body`, so DOM containment
// checks against the drawer/table elements alone can't tell whether a click
// landed inside a nested popup. Matching against the roles/classes Mantine
// applies to these layers lets us treat clicks inside any of them (including
// a Select dropdown or child modal opened from within the drawer) as "inside".
const FLOATING_LAYER_SELECTOR = [
  '[role="dialog"]',
  '[role="tooltip"]',
  '[role="listbox"]',
  '[role="menu"]',
  // role="grid" is used by both Mantine date-picker calendars and ordinary
  // data tables; scope to Mantine calendars so we don't swallow clicks on
  // unrelated tables elsewhere on the page.
  '[class*="mantine-"][class*="calendar"] [role="grid"]',
  // Catch every Mantine dropdown variant (Popover, Combobox, Select, Menu, …)
  '[class*="mantine-"][class*="dropdown"]',
  // Overlays belong to modals layered on top of the (overlay-less) drawer.
  '[class*="mantine-Overlay"]',
].join(',');

/**
 * Closes an open, overlay-less drawer when the user clicks outside of it.
 *
 * The drawer content itself (any `role="dialog"` element) and any floating
 * layer opened from within it are ignored automatically. Pass
 * `keepOpenSelector` to designate additional "safe" regions — e.g. the results
 * table — where clicks should keep the drawer open instead of closing it.
 */
export function useCloseOnClickOutside({
  enabled,
  keepOpenSelector,
  onClose,
}: {
  enabled: boolean;
  keepOpenSelector?: string;
  onClose: () => void;
}) {
  const stableOnClose = useStableCallback(onClose);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest(FLOATING_LAYER_SELECTOR)) {
        return;
      }
      if (keepOpenSelector && target.closest(keepOpenSelector)) {
        return;
      }
      stableOnClose();
    };

    // Capture phase so we still see the click even if a child stops
    // propagation during the bubble phase.
    document.addEventListener('mousedown', handleMouseDown, true);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, [enabled, keepOpenSelector, stableOnClose]);
}
