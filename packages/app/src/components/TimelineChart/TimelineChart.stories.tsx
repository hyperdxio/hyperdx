import { Group, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';
import { IconChevronDown } from '@tabler/icons-react';

import { TimelineChart } from './TimelineChart';
import type { TTimelineEvent } from './TimelineChartRowEvents';
import type { TTimelineSpanEventMarker } from './TimelineSpanEventMarker';

import styles from '@/../styles/LogSidePanel.module.scss';

function makeRow(
  id: string,
  serviceName: string,
  body: string,
  start: number,
  duration: number,
  level = 0,
  childCount = 0,
  markers?: TTimelineSpanEventMarker[],
) {
  const event: TTimelineEvent = {
    id,
    start,
    end: start + duration,
    tooltip: body,
    color: 'var(--color-text-inverted)',
    backgroundColor: '#6A7077',
    body: <span>{body}</span>,
    minWidthPx: 2,
    showDuration: true,
    markers,
  };

  return {
    id,
    label: (
      <div
        className={`text-truncate cursor-pointer ps-2 ${styles.traceTimelineLabel}`}
      >
        <div className="d-flex align-items-center" style={{ height: 24 }}>
          {Array.from({ length: level }).map((_, idx) => (
            <div
              // eslint-disable-next-line @eslint-react/no-array-index-key
              key={idx}
              style={{
                borderLeft: '1px solid var(--color-border)',
                marginLeft: 7,
                width: 8,
                minWidth: 8,
                maxWidth: 8,
                flexShrink: 0,
                height: '100%',
              }}
            />
          ))}
          <span style={{ opacity: childCount > 0 ? 1 : 0 }}>
            <IconChevronDown size={16} className="me-1 text-muted-hover" />
          </span>
          {childCount > 0 && (
            <Text span size="xxs" me="xs" pt="2px">
              ({childCount})
            </Text>
          )}
          <Group gap={0} wrap="nowrap">
            <Text size="xxs" truncate="end" span>
              {serviceName} | {body}
            </Text>
          </Group>
        </div>
      </div>
    ),
    events: [event],
  };
}

const services = [
  'api-gateway',
  'checkout-service',
  'inventory-service',
  'payment-service',
  'postgres',
  'redis',
  'kafka',
  'clickhouse',
];
// Long-running operations produce multi-second spans; the short ops produce
// sub-100ms database writes. This mix of durations exercises how the waterfall
// renders both very long and very short spans on the same timeline.
const longOps = ['SELECT', 'aggregate', 'query', 'validateToken'];
const shortOps = ['INSERT', 'UPDATE', 'DELETE', 'SET', 'GET'];

// Small deterministic PRNG (mulberry32) so the story renders identically on
// every load instead of depending on Math.random().
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TRACE_DURATION_MS = 8000;

// Builds a realistic sample trace (~414 spans across ~8s) that mixes a wide
// range of span durations so the story exercises the full breadth of the
// waterfall's rendering, including its minimum-width behavior and zooming.
//
//
// The generated trace mixes:
//   - a root span covering the whole trace,
//   - a few long spans (up to ~2.4s),
//   - a spread of mid-range children (tens to hundreds of ms, up to ~1.2s), and
//   - many very short (14-29ms) database writes that fall below the min-width
//     floor.
const sampleRows = (() => {
  const rand = mulberry32(2312);
  const rows: ReturnType<typeof makeRow>[] = [];

  // Root span covering the whole ~8s trace.
  rows.push(
    makeRow(
      'root',
      services[0],
      'GET /api/checkout',
      0,
      TRACE_DURATION_MS * 0.985,
      0,
      8,
    ),
  );

  const groupCount = 8;
  const groupWindow = TRACE_DURATION_MS / groupCount;

  for (let g = 0; g < groupCount; g++) {
    const service = services[1 + (g % (services.length - 1))];
    const groupStart = g * groupWindow + rand() * (groupWindow * 0.1);

    // One long-running span per group. Group 1 gets an explicit ~2.4s span so
    // there is a clear "hundreds of times longer" reference bar.
    const longDuration = g === 1 ? 2400 : 300 + rand() * (groupWindow * 1.4);
    const shortCount = 40 + Math.floor(rand() * 12); // ~40-51 tiny children

    rows.push(
      makeRow(
        `svc-${g}`,
        service,
        `${longOps[g % longOps.length]} batch-${g}`,
        groupStart,
        longDuration,
        1,
        shortCount,
      ),
    );

    // Children scattered inside the long span. Each picks a duration from a
    // weighted set of ranges so the waterfall covers a good spread of widths:
    // mostly tiny sub-floor DB writes, plus a healthy sprinkling of mid-range
    // (100s of ms) and occasional near-second spans.
    for (let s = 0; s < shortCount; s++) {
      const roll = rand();
      let childDuration: number;
      if (roll < 0.5) {
        childDuration = 14 + Math.floor(rand() * 16); // 14-29ms (below floor)
      } else if (roll < 0.72) {
        childDuration = 30 + Math.floor(rand() * 60); // 30-89ms
      } else if (roll < 0.92) {
        childDuration = 100 + Math.floor(rand() * 400); // 100-499ms
      } else {
        childDuration = 500 + Math.floor(rand() * 700); // 500-1199ms
      }
      // Keep the child within its parent span.
      childDuration = Math.min(childDuration, Math.floor(longDuration));
      const start =
        groupStart + rand() * Math.max(longDuration - childDuration, 1);
      rows.push(
        makeRow(
          `svc-${g}-w${s}`,
          services[4 + (s % 4)], // postgres / redis / kafka / clickhouse
          `${shortOps[s % shortOps.length]} row-${s}`,
          start,
          childDuration,
          2,
          0,
        ),
      );
    }
  }

  return rows;
})();

const meta: Meta<typeof TimelineChart> = {
  title: 'Components/TimelineChart',
  component: TimelineChart,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <div style={{ border: '1px solid lightgray' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof TimelineChart>;

export const Default: Story = {
  args: {
    rows: sampleRows,
    rowHeight: 24,
    labelWidth: 300,
    maxHeight: 800,
    initialScrollRowIndex: 0,
  },
};

// Variant with span-event markers (the green diamonds) clustered near the
// timeline start. Use this to verify diamonds paint above their bar but never
// over the sticky left-hand label column — scroll the chart vertically so a
// marked span sits behind the labels and confirm the labels stay on top.
const markedRows = (() => {
  const makeMarkers = (base: number): TTimelineSpanEventMarker[] =>
    [0, 20, 45, 80].map((offset, idx) => ({
      timestamp: base + offset,
      name: `span.event.${idx}`,
      attributes: {
        'event.index': idx,
        'exception.type': idx % 2 === 0 ? 'RetryableError' : 'Timeout',
        'exception.message': `sample span event detail #${idx}`,
      },
    }));

  return sampleRows.map((row, idx) => {
    // Add markers to the first few spans (which start near t=0) so they land
    // under the label column once the list is scrolled.
    if (idx > 4) return row;
    const event = row.events[0];
    return {
      ...row,
      events: [
        {
          ...event,
          markers: makeMarkers(event.start),
        },
      ],
    };
  });
})();

export const WithSpanEvents: Story = {
  args: {
    rows: markedRows,
    rowHeight: 24,
    labelWidth: 300,
    maxHeight: 800,
    initialScrollRowIndex: 0,
  },
};
