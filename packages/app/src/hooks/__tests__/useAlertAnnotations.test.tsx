import { AlertState, AlertTransition } from '@hyperdx/common-utils/dist/types';

import { alertTransitionsToAnnotations } from '@/hooks/useAlertAnnotations';
import { getChartColorError, getChartColorSuccess } from '@/utils';

const makeTransition = (
  createdAt: string,
  state: AlertState,
): AlertTransition => ({ createdAt, state });

describe('alertTransitionsToAnnotations', () => {
  it('returns no annotations for an empty list', () => {
    expect(alertTransitionsToAnnotations([])).toEqual([]);
  });

  it('maps a firing to a red "Alert" marker and a recovery to a green "OK" marker', () => {
    const firedAt = '2026-07-01T00:05:00.000Z';
    const recoveredAt = '2026-07-01T00:20:00.000Z';

    const annotations = alertTransitionsToAnnotations([
      makeTransition(firedAt, AlertState.ALERT),
      makeTransition(recoveredAt, AlertState.OK),
    ]);

    expect(annotations).toHaveLength(2);
    expect(annotations[0]).toMatchObject({
      time: firedAt,
      label: 'Alert',
      color: getChartColorError(),
    });
    expect(annotations[1]).toMatchObject({
      time: recoveredAt,
      label: 'OK',
      color: getChartColorSuccess(),
    });
    // Distinct keys so React can reconcile the markers.
    expect(annotations[0].key).not.toEqual(annotations[1].key);
  });
});
