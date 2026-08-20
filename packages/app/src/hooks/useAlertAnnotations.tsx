import { useMemo } from 'react';
import { AlertState, AlertTransition } from '@hyperdx/common-utils/dist/types';

import api from '@/api';
import { ChartAnnotation } from '@/components/charts/chartAnnotations';
import { getChartColorError, getChartColorSuccess } from '@/utils';

/**
 * Maps alert state transitions to generic chart annotations: firing (→ ALERT)
 * is a red "Alert" marker, recovery (→ OK) a green "OK" marker. Colors come
 * from the theme's semantic chart palette (error / success). Markers are drawn
 * at the transition's `bucketStart` — charts plot each bucket's value at its
 * start, while the evaluation runs at the bucket end (`createdAt`) — so the
 * marker lines up with the data point that produced the transition (and with
 * the evaluation table, which shows the same bucket start). `createdAt` is the
 * fallback for older API responses without `bucketStart`.
 */
export function alertTransitionsToAnnotations(
  transitions: AlertTransition[],
): ChartAnnotation[] {
  // Resolve the two theme colors once (each reads computed styles).
  const alertColor = getChartColorError();
  const okColor = getChartColorSuccess();
  return transitions.map(transition => {
    const isFiring = transition.state === AlertState.ALERT;
    const time = transition.bucketStart ?? transition.createdAt;
    return {
      time,
      label: isFiring ? 'Alert' : 'OK',
      color: isFiring ? alertColor : okColor,
      key: `alert-annotation-${time}-${transition.state}`,
    };
  });
}

/**
 * Returns alert firing/recovery annotations for a dashboard tile, scoped to the
 * given `dateRange` (the tile's visible window). Returns annotation *data*; the
 * chart renders it (clamping/band geometry needs the chart's x-axis domain). The
 * query stays idle unless `enabled` is true and an `alertId` is present.
 */
export function useAlertAnnotations(
  alertId: string | undefined,
  dateRange: [Date, Date],
  enabled: boolean = false,
): ChartAnnotation[] | undefined {
  const { data } = api.useAlertHistory(alertId, dateRange, { enabled });

  return useMemo(() => {
    if (!enabled || !data?.data.length) {
      return undefined;
    }
    return alertTransitionsToAnnotations(data.data);
  }, [enabled, data]);
}
