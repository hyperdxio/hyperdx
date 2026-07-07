import { useCallback, useMemo } from 'react';
import { parseAsStringEnum, useQueryState } from 'nuqs';

import {
  NavEntry,
  parseNavStack,
  parseSourceStack,
  SourceFrame,
  Tab,
} from '@/components/DBRowSidePanel.types';
import { parseAsJsonEncoded, parseAsStringEncoded } from '@/utils/queryParsers';

const EMPTY_SOURCE_STACK: SourceFrame[] = [];
const EMPTY_NAV_STACK: NavEntry[] = [];

export function deriveEffectiveTrail(params: {
  rawSourceStack: SourceFrame[];
  rawNavStack: NavEntry[];
  stackRoot: string | null;
  initialRowId: string | undefined;
}): {
  sourceStack: SourceFrame[];
  navStack: NavEntry[];
  isStale: boolean;
} {
  const { rawSourceStack, rawNavStack, stackRoot, initialRowId } = params;
  const hasStacks = rawSourceStack.length > 0 || rawNavStack.length > 0;
  const isStale = hasStacks && (stackRoot ?? null) !== (initialRowId ?? null);
  return {
    sourceStack: isStale ? EMPTY_SOURCE_STACK : rawSourceStack,
    navStack: isStale ? EMPTY_NAV_STACK : rawNavStack,
    isStale,
  };
}

export function reconcileTab(
  tab: Tab | null,
  availableTabs: readonly Tab[],
  defaultTab: Tab,
): Tab {
  if (tab != null && availableTabs.includes(tab)) {
    return tab;
  }
  return defaultTab;
}

export type SidePanelStack = {
  /** Owner-gated cross-source frames (empty if the persisted trail is stale). */
  sourceStack: SourceFrame[];
  /** Owner-gated same-source drilldown entries. */
  navStack: NavEntry[];
  /** True when a persisted trail was discarded because it belongs to another row. */
  isStale: boolean;
  /** Persisted tab, or null when unset. Reconcile against the source's tabs. */
  tab: Tab | null;

  /** Push a cross-source frame (e.g. View Trace) and jump to its default tab. */
  pushSource: (frame: SourceFrame, destinationTab: Tab) => void;
  /** Push a same-source drilldown (e.g. surrounding context) + destination tab. */
  pushNav: (entry: NavEntry, destinationTab: Tab) => void;
  /**
   * Pop one level (nav → source → nothing), restoring the tab that was active
   * before the popped level was entered. Returns what was popped so the caller
   * can route "nothing left" to parent/close.
   */
  popOne: () => 'nav' | 'source' | 'none';
  /** Truncate both stacks to the given lengths (breadcrumb jump), restoring tab. */
  truncateTo: (sourceLevel: number, navLevel: number) => void;
  /** Set the active tab. */
  setTab: (tab: Tab) => void;
  /** Clear the whole trail + owner token + tab (panel close / new selection). */
  clearTrail: () => void;
};

/**
 * Owns all side-panel navigation URL params behind a single read-time owner
 * gate. Every consumer reads the *effective* trail from here rather than the raw
 * params, so a stale value left in the URL by some un-cleared write path can
 * never be rendered.
 */
export default function useSidePanelStack({
  initialRowId,
}: {
  initialRowId: string | undefined;
}): SidePanelStack {
  const [rawSourceStack, setSourceStack] = useQueryState(
    'sidePanelSourceStack',
    parseAsJsonEncoded<SourceFrame[]>(parseSourceStack).withDefault(
      EMPTY_SOURCE_STACK,
    ),
  );

  const [rawNavStack, setNavStack] = useQueryState(
    'sidePanelNavStack',
    parseAsJsonEncoded<NavEntry[]>(parseNavStack).withDefault(EMPTY_NAV_STACK),
  );

  const [stackRoot, setStackRoot] = useQueryState(
    'sidePanelStackRoot',
    parseAsStringEncoded,
  );

  const [tab, setQueryTab] = useQueryState(
    'sidePanelTab',
    parseAsStringEnum<Tab>(Object.values(Tab)),
  );

  const { sourceStack, navStack, isStale } = useMemo(
    () =>
      deriveEffectiveTrail({
        rawSourceStack,
        rawNavStack,
        stackRoot,
        initialRowId,
      }),
    [rawSourceStack, rawNavStack, stackRoot, initialRowId],
  );

  const pushSource = useCallback(
    (frame: SourceFrame, destinationTab: Tab) => {
      // Compute from the *effective* stack (empty when stale) so a push from a
      // stale URL starts a fresh, owned trail instead of extending old frames.
      setSourceStack([
        ...sourceStack,
        { ...frame, originTab: tab ?? undefined },
      ]);
      setNavStack([]);
      setStackRoot(initialRowId ?? null);
      setQueryTab(destinationTab);
    },
    [
      sourceStack,
      tab,
      initialRowId,
      setSourceStack,
      setNavStack,
      setStackRoot,
      setQueryTab,
    ],
  );

  const pushNav = useCallback(
    (entry: NavEntry, destinationTab: Tab) => {
      setNavStack([...navStack, { ...entry, originTab: tab ?? undefined }]);
      setStackRoot(initialRowId ?? null);
      setQueryTab(destinationTab);
    },
    [navStack, tab, initialRowId, setNavStack, setStackRoot, setQueryTab],
  );

  const popOne = useCallback((): 'nav' | 'source' | 'none' => {
    if (navStack.length > 0) {
      const restoreTab = navStack[navStack.length - 1]?.originTab;
      setNavStack(navStack.slice(0, -1));
      if (restoreTab) {
        setQueryTab(restoreTab);
      }
      return 'nav';
    }
    if (sourceStack.length > 0) {
      const restoreTab = sourceStack[sourceStack.length - 1]?.originTab;
      setSourceStack(sourceStack.slice(0, -1));
      setNavStack([]);
      if (restoreTab) {
        setQueryTab(restoreTab);
      }
      return 'source';
    }
    return 'none';
  }, [navStack, sourceStack, setNavStack, setSourceStack, setQueryTab]);

  const truncateTo = useCallback(
    (sourceLevel: number, navLevel: number) => {
      // Restore the tab active at the level we're returning to: the first source
      // frame being dropped, or (staying within the same source) the first nav
      // entry being dropped.
      let restoreTab: Tab | undefined;
      if (sourceLevel < sourceStack.length) {
        restoreTab = sourceStack[sourceLevel]?.originTab;
      } else if (navLevel < navStack.length) {
        restoreTab = navStack[navLevel]?.originTab;
      }
      setSourceStack(sourceStack.slice(0, sourceLevel));
      setNavStack(navStack.slice(0, navLevel));
      if (restoreTab) {
        setQueryTab(restoreTab);
      }
    },
    [sourceStack, navStack, setSourceStack, setNavStack, setQueryTab],
  );

  const setTab = useCallback((next: Tab) => setQueryTab(next), [setQueryTab]);

  const clearTrail = useCallback(() => {
    setSourceStack(null); // sidePanelSourceStack
    setNavStack(null); // sidePanelNavStack
    setStackRoot(null); // sidePanelStackRoot
    setQueryTab(null); // sidePanelTab
  }, [setSourceStack, setNavStack, setStackRoot, setQueryTab]);

  return useMemo(
    () => ({
      sourceStack,
      navStack,
      isStale,
      tab,
      pushSource,
      pushNav,
      popOne,
      truncateTo,
      setTab,
      clearTrail,
    }),
    [
      clearTrail,
      isStale,
      navStack,
      popOne,
      pushNav,
      pushSource,
      setTab,
      sourceStack,
      tab,
      truncateTo,
    ],
  );
}
