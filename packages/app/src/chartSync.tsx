import { createContext, useContext, useId } from 'react';

/**
 * The default recharts `syncId` group. Charts sharing a syncId cross-highlight
 * (a hover on one shows a shadow tooltip/cursor on the others at the same x).
 */
const DEFAULT_CHART_SYNC_ID = 'hdx';

/**
 * The recharts `syncId` for charts beneath it (read via `useChartSyncId()`).
 * Defaults to the page-wide group; wrap an isolated surface in a provider with a
 * distinct id so its charts sync among themselves but not with the page.
 */
const ChartSyncContext = createContext<string>(DEFAULT_CHART_SYNC_ID);

export function useChartSyncId() {
  return useContext(ChartSyncContext);
}

/**
 * Isolates chart syncing to this subtree via a fresh `useId` scope. Use on
 * overlays (modals, side panels) so hovering a chart there doesn't show shadow
 * tooltips on the charts behind it.
 */
export function IsolatedChartSyncProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const syncId = useId();
  return (
    <ChartSyncContext.Provider value={syncId}>
      {children}
    </ChartSyncContext.Provider>
  );
}
