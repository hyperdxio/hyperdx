import React from 'react';
import { Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { AlertThresholdType } from '@hyperdx/common-utils/dist/types';
import { render } from '@testing-library/react';

import { getAlertReferenceLines } from '@/components/Alerts';

type Rect = { top: number; bottom: number };

function renderAreas(
  thresholdType: AlertThresholdType,
  threshold: number,
  thresholdMax?: number,
): { rects: Rect[]; thresholdY: number; thresholdMaxY?: number } {
  const { container } = render(
    <LineChart
      width={400}
      height={300}
      data={[
        { t: 0, v: 10 },
        { t: 1, v: 80 },
      ]}
    >
      <XAxis dataKey="t" />
      <YAxis domain={[0, 100]} />
      <Line dataKey="v" isAnimationActive={false} />
      {getAlertReferenceLines({ threshold, thresholdMax, thresholdType })}
      <ReferenceLine y={threshold} />
      {thresholdMax != null ? <ReferenceLine y={thresholdMax} /> : null}
    </LineChart>,
  );

  const rects = Array.from(
    container.querySelectorAll('.recharts-reference-area-rect'),
  ).map(r => {
    const top = Number(r.getAttribute('y'));
    return { top, bottom: top + Number(r.getAttribute('height')) };
  });
  const lineYs = Array.from(
    container.querySelectorAll('.recharts-reference-line-line'),
  ).map(l => Number(l.getAttribute('y1')));

  return {
    rects,
    thresholdY: lineYs[0],
    thresholdMaxY: lineYs[1],
  };
}

const EPS = 1;

describe('getAlertReferenceLines shading', () => {
  it.each([AlertThresholdType.ABOVE, AlertThresholdType.ABOVE_EXCLUSIVE])(
    'shades above the threshold line for %s',
    thresholdType => {
      const { rects, thresholdY } = renderAreas(thresholdType, 50);
      expect(rects).toHaveLength(1);
      expect(rects[0].top).toBeLessThan(thresholdY);
      expect(rects[0].bottom).toBeLessThanOrEqual(thresholdY + EPS);
    },
  );

  it.each([AlertThresholdType.BELOW, AlertThresholdType.BELOW_OR_EQUAL])(
    'shades below the threshold line for %s',
    thresholdType => {
      const { rects, thresholdY } = renderAreas(thresholdType, 50);
      expect(rects).toHaveLength(1);
      expect(rects[0].top).toBeGreaterThanOrEqual(thresholdY - EPS);
      expect(rects[0].bottom).toBeGreaterThan(thresholdY);
    },
  );

  it('shades the band between the two thresholds for BETWEEN', () => {
    const { rects, thresholdY, thresholdMaxY } = renderAreas(
      AlertThresholdType.BETWEEN,
      30,
      70,
    );
    expect(rects).toHaveLength(1);
    expect(thresholdMaxY).toBeDefined();
    expect(rects[0].top).toBeCloseTo(thresholdMaxY!, 0);
    expect(rects[0].bottom).toBeCloseTo(thresholdY, 0);
  });

  it('shades below the lower bound and above the upper bound for NOT_BETWEEN', () => {
    const { rects, thresholdY, thresholdMaxY } = renderAreas(
      AlertThresholdType.NOT_BETWEEN,
      30,
      70,
    );
    expect(rects).toHaveLength(2);
    expect(thresholdMaxY).toBeDefined();

    const lower = rects.find(r => r.bottom > thresholdY)!;
    const upper = rects.find(r => r.top < thresholdMaxY!)!;
    // Lower firing region: from the lower threshold line downward.
    expect(lower.top).toBeCloseTo(thresholdY, 0);
    // Upper firing region: from the upper threshold line upward.
    expect(upper.bottom).toBeCloseTo(thresholdMaxY!, 0);
  });
});
