import { useEffect, useRef } from 'react';
import { SavedChartConfig } from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';

import api from '@/api';

/**
 * Seeds the chart explorer from an inline alert's persisted config, given an
 * `alertId` query param.
 *
 * Inline alerts are linked to by id rather than by an inlined config because
 * the alerts list response omits `chartConfig` — a row would otherwise have no
 * link to the explorer at all. Fetching by id also opens the config as it
 * stands now, not a snapshot taken when the link was built.
 *
 * The param is cleared as soon as it has been applied (or found unusable), so
 * the URL's `config` drives every later edit exactly as a hand-built link does,
 * and a reload does not re-seed over the user's changes.
 *
 * Returns whether a seed is still outstanding. Callers should hold back a
 * chart that runs on mount until it is false: clearing the param is what
 * re-renders with the seeded config, so "param still set" is exactly "the
 * config in hand is not yet the alert's".
 */
export function useAlertSeededChartConfig({
  alertId,
  setChartConfig,
  clearAlertId,
}: {
  alertId: string | null;
  setChartConfig: (config: SavedChartConfig) => void;
  clearAlertId: () => void;
}): boolean {
  const { data, isLoading, isError } = api.useAlert(alertId ?? undefined);
  // Applying the seed clears the param, which re-renders with alertId null
  // before the write lands; latch so the effect cannot run twice for one id.
  const seededRef = useRef<string | null>(null);

  useEffect(() => {
    if (alertId == null || seededRef.current === alertId) {
      return;
    }
    if (isLoading) {
      return;
    }

    seededRef.current = alertId;

    const chartConfig = data?.data?.chartConfig;
    if (isError || chartConfig == null) {
      notifications.show({
        color: 'yellow',
        title: 'Chart unavailable',
        // Covers all three: the alert is gone, it is not readable, or it is a
        // saved-search / tile alert, none of which carry their own config.
        message: "This alert's chart could not be loaded.",
        autoClose: 5000,
      });
      clearAlertId();
      return;
    }

    setChartConfig(chartConfig);
    clearAlertId();
  }, [alertId, clearAlertId, data, isError, isLoading, setChartConfig]);

  return alertId != null;
}
