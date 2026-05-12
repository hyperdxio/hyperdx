import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Box,
  Card,
  Divider,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import type { Meta } from '@storybook/nextjs';
import { IconChartLine } from '@tabler/icons-react';

import {
  CATEGORICAL_PALETTE_TOKENS,
  CHART_PALETTE_TOKENS,
  ChartPaletteToken,
  getColorFromCSSToken,
  SEMANTIC_PALETTE_TOKENS,
} from '@/utils';

import { ColorSwatchInput } from './ColorSwatchInput';

const meta = {
  title: 'ColorSwatchInput',
  component: ColorSwatchInput,
} satisfies Meta<typeof ColorSwatchInput>;

export default meta;

// ---------------------------------------------------------------------------
// Tier 1: isolated stories (picker mechanics)
// ---------------------------------------------------------------------------

export const Default = () => {
  const [value, setValue] = React.useState<ChartPaletteToken | undefined>(
    undefined,
  );
  return <ColorSwatchInput value={value} onChange={setValue} />;
};

export const Selected = () => {
  const [value, setValue] = React.useState<ChartPaletteToken | undefined>(
    'chart-1',
  );
  return <ColorSwatchInput value={value} onChange={setValue} />;
};

export const Disabled = () => (
  <Group gap="md">
    <ColorSwatchInput disabled />
    <ColorSwatchInput value="chart-warning" disabled />
  </Group>
);

export const WithCustomLabel = () => {
  const [value, setValue] = React.useState<ChartPaletteToken | undefined>(
    undefined,
  );
  return (
    <ColorSwatchInput value={value} onChange={setValue} label="Series color" />
  );
};

/**
 * One trigger per token, all pre-selected. Renders the full matrix so the
 * design review can compare swatch sizes, hover states, and per-token
 * contrast across themes without opening the popover thirteen times.
 */
export const AllTokensSelected = () => (
  <Stack gap="xs">
    <Text size="sm" fw={500}>
      Categorical
    </Text>
    <Group gap="xs" wrap="wrap">
      {CATEGORICAL_PALETTE_TOKENS.map(token => (
        <ColorSwatchInput key={token} value={token} />
      ))}
    </Group>
    <Text size="sm" fw={500} mt="md">
      Semantic
    </Text>
    <Group gap="xs" wrap="wrap">
      {SEMANTIC_PALETTE_TOKENS.map(token => (
        <ColorSwatchInput key={token} value={token} />
      ))}
    </Group>
  </Stack>
);

/**
 * Picker mounted alongside other form controls so reviewers can verify
 * the focus order during keyboard nav (Tab into the picker, activate
 * with Enter or Space, Tab between swatches, Esc closes).
 */
export const KeyboardNav = () => {
  const [value, setValue] = React.useState<ChartPaletteToken | undefined>();
  return (
    <Stack gap="md" style={{ maxWidth: 380 }}>
      <TextInput
        label="Series name"
        defaultValue="errors"
        description="Tab from this input into the picker, activate, and pick a swatch."
      />
      <ColorSwatchInput value={value} onChange={setValue} />
      <TextInput label="Tab target after the picker" placeholder="next field" />
    </Stack>
  );
};

// ---------------------------------------------------------------------------
// Tier 2: in-context stories (product framing)
//
// Storybook-only mocks. No production imports of ChartSeriesEditor or
// ChartDisplaySettingsDrawer; those land in PRs 2b through 6b. The mocks
// approximate the layouts so the design review can rule on placement
// before any consumer PR opens.
// ---------------------------------------------------------------------------

type SeriesMockData = {
  name: string;
  token: ChartPaletteToken | undefined;
  lineStyle: 'solid' | 'dashed' | 'dotted';
};

const DEFAULT_SERIES_MOCK: SeriesMockData[] = [
  { name: 'errors', token: 'chart-error', lineStyle: 'solid' },
  { name: 'warnings', token: 'chart-warning', lineStyle: 'dashed' },
  { name: 'successes', token: 'chart-success', lineStyle: 'solid' },
];

const MOCK_TIME_DATA = Array.from({ length: 12 }).map((_, i) => ({
  t: `${i}:00`,
  errors: Math.round(20 + 8 * Math.sin(i / 2)),
  warnings: Math.round(40 + 12 * Math.cos(i / 3)),
  successes: Math.round(120 + 25 * Math.sin(i / 4 + 1)),
}));

const LINE_STYLE_DASHARRAY: Record<SeriesMockData['lineStyle'], string> = {
  solid: '0',
  dashed: '4 3',
  dotted: '2 2',
};

function parseLineStyle(value: string | null): SeriesMockData['lineStyle'] {
  if (value === 'dashed' || value === 'dotted') return value;
  return 'solid';
}

function MockSeriesPreview({
  series,
  variant,
  height = 140,
}: {
  series: SeriesMockData[];
  variant: 'line' | 'bar';
  height?: number;
}) {
  const ChartCmp = variant === 'line' ? LineChart : BarChart;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ChartCmp
        data={MOCK_TIME_DATA}
        margin={{ left: 0, right: 12, top: 8, bottom: 0 }}
      >
        <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 2" />
        <XAxis dataKey="t" hide />
        <YAxis hide />
        <Tooltip cursor={false} />
        {series.map(s => {
          const color = s.token
            ? getColorFromCSSToken(s.token)
            : 'var(--color-text-muted)';
          return variant === 'line' ? (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={color}
              strokeDasharray={LINE_STYLE_DASHARRAY[s.lineStyle]}
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ) : (
            <Bar
              key={s.name}
              dataKey={s.name}
              stackId="stack"
              fill={color}
              isAnimationActive={false}
            />
          );
        })}
      </ChartCmp>
    </ResponsiveContainer>
  );
}

function SeriesRow({
  series,
  onChange,
}: {
  series: SeriesMockData;
  onChange: (next: SeriesMockData) => void;
}) {
  return (
    <Group
      gap="xs"
      wrap="nowrap"
      align="center"
      style={{
        padding: '6px 8px',
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        background: 'var(--color-bg-field)',
      }}
    >
      <Text size="xs" style={{ minWidth: 90 }}>
        {series.name}
      </Text>
      <Text size="xs" c="dimmed">
        count(*)
      </Text>
      <Box style={{ flex: 1 }} />
      <ColorSwatchInput
        value={series.token}
        onChange={token => onChange({ ...series, token })}
      />
      <Select
        size="xs"
        w={92}
        value={series.lineStyle}
        onChange={v => onChange({ ...series, lineStyle: parseLineStyle(v) })}
        data={[
          { value: 'solid', label: 'Solid' },
          { value: 'dashed', label: 'Dashed' },
          { value: 'dotted', label: 'Dotted' },
        ]}
      />
    </Group>
  );
}

function useSeriesList() {
  const [seriesList, setSeriesList] =
    React.useState<SeriesMockData[]>(DEFAULT_SERIES_MOCK);
  const updateAt = React.useCallback((idx: number, next: SeriesMockData) => {
    setSeriesList(curr => curr.map((s, i) => (i === idx ? next : s)));
  }, []);
  return { seriesList, updateAt };
}

/**
 * Mocks the eventual `ChartSeriesEditor` layout: a stack of series rows,
 * each carrying the palette picker + line-style dropdown inline. A small
 * Recharts preview above the rows reacts to picks in real time.
 */
export const InSeriesRow = () => {
  const { seriesList, updateAt } = useSeriesList();
  return (
    <Stack gap="sm" style={{ maxWidth: 540 }}>
      <Card withBorder padding="sm">
        <Group gap="xs" mb={6}>
          <IconChartLine size={14} stroke={1.5} />
          <Text size="sm" fw={500}>
            Line tile preview
          </Text>
        </Group>
        <MockSeriesPreview series={seriesList} variant="line" />
      </Card>
      <Stack gap={6}>
        {seriesList.map((s, i) => (
          <SeriesRow
            key={s.name}
            series={s}
            onChange={next => updateAt(i, next)}
          />
        ))}
      </Stack>
    </Stack>
  );
};

function InTimeChart({ variant }: { variant: 'line' | 'bar' }) {
  const { seriesList, updateAt } = useSeriesList();
  return (
    <Group align="stretch" gap="md" wrap="nowrap" style={{ maxWidth: 880 }}>
      <Card withBorder padding="sm" style={{ flex: 1 }}>
        <Text size="sm" fw={500} mb={6}>
          {variant === 'line'
            ? 'Errors / warnings / successes over time'
            : 'Stacked bar tile preview'}
        </Text>
        <MockSeriesPreview series={seriesList} variant={variant} height={220} />
      </Card>
      <Card withBorder padding="sm" w={300}>
        <Text size="xs" c="dimmed" mb={6}>
          Series
        </Text>
        <Stack gap={6}>
          {seriesList.map((s, i) => (
            <SeriesRow
              key={s.name}
              series={s}
              onChange={next => updateAt(i, next)}
            />
          ))}
        </Stack>
      </Card>
    </Group>
  );
}

/** Production-shaped layout for a line tile: chart on top, series panel on the side. */
export const InLineChart = () => <InTimeChart variant="line" />;

/** Same shape as `InLineChart` but driving a stacked-bar tile. */
export const InStackedBar = () => <InTimeChart variant="bar" />;

/**
 * Mocked number tile: the picker drives the static color of the rendered
 * value. The threshold editor with operator / value / per-rule colors is
 * out of scope for this PR and lands with PR 6b; for the design review we
 * only need to lock in placement of the color picker.
 */
export const InNumberTile = () => {
  const [color, setColor] = React.useState<ChartPaletteToken | undefined>(
    'chart-success',
  );
  const resolved = color ? getColorFromCSSToken(color) : 'var(--color-text)';
  return (
    <Group align="stretch" gap="md" wrap="nowrap" style={{ maxWidth: 600 }}>
      <Card withBorder padding="md" style={{ flex: 1 }}>
        <Text size="xs" c="dimmed" mb={6}>
          Request rate (rps)
        </Text>
        <Text
          style={{
            fontSize: 48,
            fontWeight: 600,
            color: resolved,
            lineHeight: 1,
          }}
        >
          1,234
        </Text>
      </Card>
      <Card withBorder padding="md" w={260}>
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            Static color
          </Text>
          <ColorSwatchInput value={color} onChange={setColor} />
          <Divider my={4} />
          <Text size="xs" c="dimmed">
            Thresholds (preview only)
          </Text>
          <Text size="xs">≥ 500 &rarr; chart-error</Text>
          <Text size="xs">≥ 100 &rarr; chart-warning</Text>
        </Stack>
      </Card>
    </Group>
  );
};

/**
 * Mocked reference-line editor focused on the picker. The value / label /
 * style inputs that wrap it on the editor side land with PR 5b; for this
 * PR we only need to lock in how the picker reads inside the editor.
 */
export const InReferenceLineEditor = () => {
  const [token, setToken] = React.useState<ChartPaletteToken | undefined>(
    'chart-warning',
  );
  return (
    <Stack gap="sm" style={{ maxWidth: 560 }}>
      <Card withBorder padding="sm">
        <Text size="sm" fw={500} mb={6}>
          Line chart with reference line
        </Text>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart
            data={MOCK_TIME_DATA}
            margin={{ left: 0, right: 12, top: 8, bottom: 0 }}
          >
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 2" />
            <XAxis dataKey="t" hide />
            <YAxis hide domain={[0, 200]} />
            <Tooltip cursor={false} />
            <Line
              type="monotone"
              dataKey="warnings"
              stroke={getColorFromCSSToken('chart-2')}
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
            <ReferenceLine
              y={100}
              stroke={token ? getColorFromCSSToken(token) : 'transparent'}
              strokeDasharray="4 3"
              label={{
                value: 'SLA',
                position: 'insideTopRight',
                fill: token ? getColorFromCSSToken(token) : undefined,
                fontSize: 11,
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </Card>
      <Card withBorder padding="sm">
        <Group gap="md" align="center">
          <Text size="xs" c="dimmed">
            Reference-line color
          </Text>
          <ColorSwatchInput value={token} onChange={setToken} />
        </Group>
      </Card>
    </Stack>
  );
};

/**
 * Reference: every available palette token, rendered as a row of pre-selected
 * pickers. Useful as a single screenshot for design review.
 */
export const TokensReference = () => (
  <Group gap={4} wrap="wrap" style={{ maxWidth: 800 }}>
    {CHART_PALETTE_TOKENS.map(token => (
      <ColorSwatchInput key={token} value={token} />
    ))}
  </Group>
);
