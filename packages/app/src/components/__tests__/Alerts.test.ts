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

  it("includes 0 for BELOW, matching the reference area's fixed bottom edge", () => {
    // Regression: getAlertReferenceLines renders BELOW/BELOW_OR_EQUAL with
    // y1={0} - omitting 0 here let Recharts silently widen the domain later.
    expect(
      getAlertReferenceLineValues({
        threshold: 550,
        thresholdMax: undefined,
        thresholdType: AlertThresholdType.BELOW,
      }),
    ).toEqual([0, 550]);
  });

  it("includes 0 for BELOW_OR_EQUAL, matching the reference area's fixed bottom edge", () => {
    expect(
      getAlertReferenceLineValues({
        threshold: 550,
        thresholdMax: undefined,
        thresholdType: AlertThresholdType.BELOW_OR_EQUAL,
      }),
    ).toEqual([0, 550]);
  });
});
