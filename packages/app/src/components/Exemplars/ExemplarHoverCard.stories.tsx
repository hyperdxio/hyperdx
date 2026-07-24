import type { ReactNode } from 'react';
import { Exemplar } from '@hyperdx/common-utils/dist/types';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { ExemplarHoverCard } from './ExemplarHoverCard';

/**
 * Floating card shown when hovering an exemplar marker on a time chart. It shows
 * the linked trace's metadata (resolved from the configured exemplar trace
 * source) plus an "Inspect trace" button. The card is `position: absolute` and
 * flips / clamps against its offset parent so it never overflows the chart, so
 * every story wraps it in a relative, chart-sized container. Use the Theme
 * (Light / Dark) and Brand toolbar toggles to review each state.
 */
const meta = {
  title: 'Components/Exemplars/ExemplarHoverCard',
  component: ExemplarHoverCard,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ExemplarHoverCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const mockExemplar: Exemplar = {
  timestamp: 1_700_000_000_000,
  value: 128.4,
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  spanId: '00f067aa0ba902b7',
};

const hovered = { exemplar: mockExemplar, x: 60, y: 40 };

const noop = () => {};

// A relative, chart-sized container so the card's absolute positioning and
// flip/clamp logic resolve against a realistic offset parent.
function ChartArea({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: 'relative',
        width: 360,
        height: 240,
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        background: 'var(--color-bg-default)',
      }}
    >
      {children}
    </div>
  );
}

const baseArgs = {
  hovered,
  isLoading: false,
  traceSourceConfigured: true,
  onInspect: noop,
  onMouseEnter: noop,
  onMouseLeave: noop,
};

const render: Story['render'] = args => (
  <ChartArea>
    <ExemplarHoverCard {...args} />
  </ChartArea>
);

export const FullMetadata: Story = {
  render,
  args: {
    ...baseArgs,
    meta: {
      service: 'checkout-api',
      spanName: 'POST /checkout',
      durationMs: 128.42,
      statusCode: 'OK',
    },
  },
};

export const PartialMetadata: Story = {
  render,
  args: {
    ...baseArgs,
    meta: { service: 'checkout-api', durationMs: 128.42 },
  },
};

export const Loading: Story = {
  render,
  args: { ...baseArgs, isLoading: true },
};

export const TraceNotFound: Story = {
  render,
  args: { ...baseArgs, meta: undefined },
};

export const NoTraceSourceConfigured: Story = {
  render,
  args: { ...baseArgs, traceSourceConfigured: false },
};
