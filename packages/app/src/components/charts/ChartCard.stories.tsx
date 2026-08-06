import React from 'react';
import { Box, Flex, SegmentedControl } from '@mantine/core';
import type { Meta } from '@storybook/nextjs';

import { ChartCard } from './ChartCard';
import ChartContainer from './ChartContainer';

const meta = {
  title: 'Charts/ChartCard',
  component: ChartCard,
} satisfies Meta<typeof ChartCard>;

export default meta;

/**
 * A dependency-free stand-in for a real chart body so the stories render the
 * card chrome (border + header divider) without wiring up ClickHouse queries.
 */
function FakeChart({ color = 'var(--color-chart-blue)' }: { color?: string }) {
  const points = [4, 18, 10, 26, 14, 30, 20, 34, 22, 40, 28, 44];
  const max = Math.max(...points);
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * 100;
      const y = 100 - (p / max) * 100;
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * The common case: a single titled chart. `ChartCard` supplies the card-mode
 * header, so the title sits above a full-bleed divider inside a bordered
 * surface — the same treatment as a custom dashboard tile.
 */
export const Default = () => (
  <Box style={{ width: 480, height: 260 }}>
    <ChartCard>
      <ChartContainer title="Throughput">
        <FakeChart />
      </ChartContainer>
    </ChartCard>
  </Box>
);

/**
 * Header actions (toolbar items) render right-aligned on the divider row. Here a
 * Rate/Vol toggle mirrors the Errors chart on the search page.
 */
export const WithToolbar = () => {
  const [mode, setMode] = React.useState('rate');
  return (
    <Box style={{ width: 480, height: 260 }}>
      <ChartCard>
        <ChartContainer
          title="Errors"
          toolbarItems={[
            <SegmentedControl
              key="mode"
              size="xs"
              value={mode}
              onChange={setMode}
              data={[
                { label: 'Rate', value: 'rate' },
                { label: 'Vol', value: 'volume' },
              ]}
            />,
          ]}
        >
          <FakeChart color="var(--color-chart-error)" />
        </ChartContainer>
      </ChartCard>
    </Box>
  );
};

/**
 * The RED row from the trace search results: three equal-width cards under a
 * shared height. Each card fills its column via `flex: 1; height: 100%`.
 */
export const RedRow = () => {
  const cardStyle = { flex: 1, minWidth: 0, minHeight: 0, height: '100%' };
  return (
    <Flex direction="row" gap="sm" style={{ width: 900, height: 240 }}>
      <ChartCard style={cardStyle}>
        <ChartContainer title="Throughput">
          <FakeChart />
        </ChartContainer>
      </ChartCard>
      <ChartCard style={cardStyle}>
        <ChartContainer title="Errors">
          <FakeChart color="var(--color-chart-error)" />
        </ChartContainer>
      </ChartCard>
      <ChartCard style={cardStyle}>
        <ChartContainer title="Duration">
          <FakeChart color="var(--color-chart-green)" />
        </ChartContainer>
      </ChartCard>
    </Flex>
  );
};

/**
 * With no title and no toolbar the header row is omitted entirely, so the card
 * degrades to a plain bordered surface (no divider).
 */
export const NoHeader = () => (
  <Box style={{ width: 480, height: 260 }}>
    <ChartCard>
      <ChartContainer>
        <FakeChart color="var(--color-chart-green)" />
      </ChartContainer>
    </ChartCard>
  </Box>
);
