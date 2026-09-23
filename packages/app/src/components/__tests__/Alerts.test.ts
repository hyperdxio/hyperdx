import { AlertThresholdType } from '@hyperdx/common-utils/dist/types';

import { getAlertReferenceLineValues } from '@/components/Alerts';

describe('getAlertReferenceLineValues', () => {
  it('returns only threshold for a simple (non-range) alert type', () => {
    expect(
      getAlertReferenceLineValues({
        threshold: 50,
        thresholdMax: undefined,
        thresholdType: AlertThresholdType.ABOVE,
      }),
    ).toEqual([50]);
  });

  it('ignores a stale thresholdMax left over from a since-changed alert type', () => {
    // Regression: getAlertReferenceLines only draws thresholdMax for
    // BETWEEN/NOT_BETWEEN - a leftover value here would silently widen the
    // Y-axis domain around a line that's never actually rendered.
    expect(
      getAlertReferenceLineValues({
        threshold: 50,
        thresholdMax: 500,
        thresholdType: AlertThresholdType.ABOVE,
      }),
    ).toEqual([50]);
  });

  it('includes both values for BETWEEN, matching the rendered reference area', () => {
    expect(
      getAlertReferenceLineValues({
        threshold: 10,
        thresholdMax: 20,
        thresholdType: AlertThresholdType.BETWEEN,
      }),
    ).toEqual([10, 20]);
  });

  it('includes both values for NOT_BETWEEN, matching the rendered reference areas', () => {
    expect(
      getAlertReferenceLineValues({
        threshold: 10,
        thresholdMax: 20,
        thresholdType: AlertThresholdType.NOT_BETWEEN,
      }),
    ).toEqual([10, 20]);
  });

  it('drops thresholdMax for BETWEEN when it is unset', () => {
    expect(
      getAlertReferenceLineValues({
        threshold: 10,
        thresholdMax: undefined,
        thresholdType: AlertThresholdType.BETWEEN,
      }),
    ).toEqual([10]);
  });
});
