import { screen } from '@testing-library/react';

import { AnnotationTooltip } from '@/components/charts/AnnotationTooltip';

// A version expression that concatenates several resource attributes produces
// one long unbroken value — the case that used to overflow the fixed-width
// tooltip horizontally.
const LONG_VERSION =
  'v2.14.7-rc.3+build.20260216.a1b2c3d4e5f6-k8s-cluster-eu-west-1-canary';
const LONG_SERVICE = 'checkout-orchestration-service-eu-west-1-canary';

const hovered = {
  annotation: {
    x: 1_700_000_000,
    label: LONG_VERSION,
    group: LONG_SERVICE,
    color: '#437eef',
    labelX: 0,
  },
  point: { x: 100, y: 100 },
};

describe('AnnotationTooltip', () => {
  it('wraps long release values instead of overflowing the tooltip width', () => {
    renderWithMantine(<AnnotationTooltip hovered={hovered} />);

    for (const value of [LONG_VERSION, LONG_SERVICE]) {
      const node = screen.getByText(value);
      expect(node).not.toHaveStyle({ whiteSpace: 'nowrap' });
      // `anywhere`, not `break-word`: only `anywhere` shrinks the element's
      // min-content width, which is what a `wrap="nowrap"` flex row measures.
      expect(node).toHaveStyle({ overflowWrap: 'anywhere' });
    }
  });
});
