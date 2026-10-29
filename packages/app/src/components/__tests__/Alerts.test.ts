import { isValidElement, ReactElement } from 'react';
import { AlertThresholdType } from '@hyperdx/common-utils/dist/types';

import {
  getAlertReferenceLines,
  getAlertReferenceLineValues,
} from '@/components/Alerts';

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

describe('getAlertReferenceLines', () => {
  // Recharts v3 fills an open-ended ReferenceArea from the set bound to the
  // opposite edge: a set y2 (with y1 omitted) fills up to the top, and a set
  // y1 (with y2 omitted) fills down to the bottom. These tests pin which bound
  // each threshold type sets so the red firing region stays on the correct
  // side of the threshold.
  it.each([AlertThresholdType.ABOVE, AlertThresholdType.ABOVE_EXCLUSIVE])(
    'fills up from the threshold for %s',
    thresholdType => {
      const area = getAlertReferenceLines({
        threshold: 50,
        thresholdMax: undefined,
        thresholdType,
      }) as ReactElement<{ y1?: number; y2?: number }>;
      expect(isValidElement(area)).toBe(true);
      expect(area.props.y2).toBe(50);
      expect(area.props.y1).toBeUndefined();
    },
  );

  it.each([AlertThresholdType.BELOW, AlertThresholdType.BELOW_OR_EQUAL])(
    'fills from 0 up to the threshold for %s',
    thresholdType => {
      const area = getAlertReferenceLines({
        threshold: 50,
        thresholdMax: undefined,
        thresholdType,
      }) as ReactElement<{ y1?: number; y2?: number }>;
      expect(area.props.y1).toBe(0);
      expect(area.props.y2).toBe(50);
    },
  );

  it('fills the band between the bounds for BETWEEN', () => {
    const area = getAlertReferenceLines({
      threshold: 10,
      thresholdMax: 20,
      thresholdType: AlertThresholdType.BETWEEN,
    }) as ReactElement<{ y1?: number; y2?: number }>;
    expect(area.props.y1).toBe(10);
    expect(area.props.y2).toBe(20);
  });

  it('fills below the lower bound and above the upper bound for NOT_BETWEEN', () => {
    const areas = getAlertReferenceLines({
      threshold: 10,
      thresholdMax: 20,
      thresholdType: AlertThresholdType.NOT_BETWEEN,
    }) as ReactElement<{ y1?: number; y2?: number }>[];
    expect(Array.isArray(areas)).toBe(true);

    const [lower, upper] = areas;
    // Lower region: fills down from the lower bound (y2 omitted -> bottom).
    expect(lower.props.y1).toBe(10);
    expect(lower.props.y2).toBeUndefined();
    // Upper region: fills up from the upper bound (y1 omitted -> top).
    expect(upper.props.y2).toBe(20);
    expect(upper.props.y1).toBeUndefined();
  });
});
