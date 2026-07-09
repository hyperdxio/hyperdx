import { AlertState, AlertTransition } from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import api from '@/api';
import {
  alertTransitionsToAnnotations,
  useAlertAnnotations,
} from '@/hooks/useAlertAnnotations';
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

describe('useAlertAnnotations', () => {
  const range: [Date, Date] = [
    new Date('2026-07-01T00:00:00.000Z'),
    new Date('2026-07-01T01:00:00.000Z'),
  ];

  const mockHistory = (data: unknown) =>
    jest.spyOn(api, 'useAlertHistory').mockReturnValue({ data } as any);

  afterEach(() => jest.restoreAllMocks());

  it('returns undefined when disabled, even if data is present', () => {
    mockHistory({
      data: [{ createdAt: range[0].toISOString(), state: AlertState.ALERT }],
    });
    const { result } = renderHook(() =>
      useAlertAnnotations('alert-1', range, false),
    );
    expect(result.current).toBeUndefined();
  });

  it('returns undefined when enabled but history is empty', () => {
    mockHistory({ data: [] });
    const { result } = renderHook(() =>
      useAlertAnnotations('alert-1', range, true),
    );
    expect(result.current).toBeUndefined();
  });

  it('returns reference lines when transitions exist', () => {
    mockHistory({
      data: [
        { createdAt: '2026-07-01T00:30:00.000Z', state: AlertState.ALERT },
      ],
    });
    const { result } = renderHook(() =>
      useAlertAnnotations('alert-1', range, true),
    );
    expect(result.current).toHaveLength(1);
  });
});
