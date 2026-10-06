import type { ReactNode } from 'react';
import { Exemplar } from '@hyperdx/common-utils/dist/types';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { ExemplarDot } from './ExemplarDot';

/**
 * Diamond marker overlaid on a time chart to mark an individual exemplar trace.
 * It is rendered by recharts as a `<ReferenceDot shape={<ExemplarDot />} />`, so
 * recharts injects `cx`/`cy`; here we place it inside a plain `<svg>` to show the
 * marker in isolation. The fill uses the `--color-chart-warning` token — use the
 * Theme (Light / Dark) and Brand toolbar toggles to review both.
 */
const meta = {
  title: 'Components/Exemplars/ExemplarDot',
  component: ExemplarDot,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ExemplarDot>;

export default meta;
type Story = StoryObj<typeof meta>;

const mockExemplar: Exemplar = {
  timestamp: 1_700_000_000_000,
  value: 128.4,
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  spanId: '00f067aa0ba902b7',
};

// A small chart-like canvas so the marker has a baseline for context.
function SvgCanvas({ children }: { children: ReactNode }) {
  return (
    <svg
      width={280}
      height={120}
      style={{ background: 'var(--color-bg-default)', borderRadius: 4 }}
    >
      <line
        x1={0}
        y1={80}
        x2={280}
        y2={80}
        stroke="var(--color-border)"
        strokeWidth={1}
      />
      {children}
    </svg>
  );
}

export const Default: Story = {
  args: { cx: 140, cy: 80, exemplar: mockExemplar },
  render: args => (
    <SvgCanvas>
      <ExemplarDot {...args} />
    </SvgCanvas>
  ),
};

export const AlongASeries: Story = {
  args: { exemplar: mockExemplar },
  render: args => (
    <SvgCanvas>
      {[40, 90, 140, 190, 240].map((cx, i) => (
        <ExemplarDot key={cx} {...args} cx={cx} cy={80 - i * 8} />
      ))}
    </SvgCanvas>
  ),
};
