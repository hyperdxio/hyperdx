import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Expansion state for a filter group, with a filter-name search override.
 *
 * A search opens every matching group so the match is actually visible, but
 * the user still has to be able to close one while the search is open. So the
 * override is held separately from the user's own browse state: toggling
 * during a search moves the override, leaving the browse state to be restored
 * when the search ends rather than the group staying stuck open.
 *
 * The override resets whenever a search starts or ends, so each search begins
 * from "matches are visible" again.
 *
 * `expandBrowse` is for the caller's default-expansion signal — a group gaining
 * a selection or a pin. That describes the browse state, so it has to bypass
 * the override: routing it through `setExpanded` during a search would leave
 * the browse state stale and collapse the group the moment the search cleared.
 */
export function useGroupExpansion(
  defaultExpanded: boolean,
  isForceExpanded?: boolean,
): [boolean, (expanded: boolean) => void, () => void] {
  const [browseExpanded, setBrowseExpanded] = useState(defaultExpanded);
  const [searchExpanded, setSearchExpanded] = useState<boolean | null>(null);

  // Reset during render rather than in an effect — this is the "adjust state
  // when a prop changes" case, and an effect would render the stale override
  // for a frame first.
  const [lastForced, setLastForced] = useState(isForceExpanded);
  if (lastForced !== isForceExpanded) {
    setLastForced(isForceExpanded);
    setSearchExpanded(null);
  }

  const expanded = isForceExpanded ? (searchExpanded ?? true) : browseExpanded;

  // Read through a ref so the setter keeps a stable identity: callers hold it
  // in `useCallback([])` and in effect deps, and a fresh function each render
  // would either go stale or retrigger them.
  const forcedRef = useRef(isForceExpanded);
  useEffect(() => {
    forcedRef.current = isForceExpanded;
  }, [isForceExpanded]);
  const setExpanded = useCallback((next: boolean) => {
    if (forcedRef.current) {
      setSearchExpanded(next);
    } else {
      setBrowseExpanded(next);
    }
  }, []);

  const expandBrowse = useCallback(() => setBrowseExpanded(true), []);

  return [expanded, setExpanded, expandBrowse];
}
