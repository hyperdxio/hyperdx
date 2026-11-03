import { screen } from '@testing-library/react';

import type { HoveredAnnotation } from '@/components/charts/AnnotationHitLayer';
import { AnnotationTooltip } from '@/components/charts/AnnotationTooltip';

// A version expression that concatenates several resource attributes produces
// one long unbroken value — the case that used to overflow the fixed-width
// tooltip horizontally.
const LONG_VERSION =
  'v2.14.7-rc.3+build.20260216.a1b2c3d4e5f6-k8s-cluster-eu-west-1-canary';
const LONG_SERVICE = 'checkout-orchestration-service-eu-west-1-canary';

const hovered: HoveredAnnotation = {
  annotation: {
    time: 1_700_000_000_000,
    x: 1_700_000_000,
    label: LONG_VERSION,
    group: LONG_SERVICE,
    color: '#437eef',
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

  it('floors the service name width so a long version cannot squeeze it away', () => {
    renderWithMantine(<AnnotationTooltip hovered={hovered} />);

    expect(screen.getByText(LONG_SERVICE)).toHaveStyle({ minWidth: '80px' });
  });

  it('gives the release list more height than the shared series-tooltip cap', () => {
    renderWithMantine(<AnnotationTooltip hovered={hovered} />);

    expect(screen.getByText(LONG_VERSION).closest('.chartTooltipContent'))
      // Wrapped values are several lines tall, so the shared 200px cap clips a
      // cluster of releases almost immediately.
      .toHaveClass('annotationTooltipContent');
  });
});
