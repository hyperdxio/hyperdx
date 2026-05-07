import { Group, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';
import { IconChevronDown } from '@tabler/icons-react';

import { TimelineChart } from './TimelineChart';
import type { TTimelineEvent } from './TimelineChartRowEvents';

import styles from '@/../styles/LogSidePanel.module.scss';

function makeRow(
  id: string,
  serviceName: string,
  body: string,
  start: number,
  duration: number,
  level = 0,
  childCount = 0,
) {
  const event: TTimelineEvent = {
    id,
    start,
    end: start + duration,
    tooltip: body,
    color: 'var(--color-text-inverted)',
    backgroundColor: '#6A7077',
    body: <span>{body}</span>,
    minWidthPerc: 1,
    showDuration: true,
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
  'auth-service',
  'user-service',
  'postgres',
  'dashboard-svc',
  'redis',
  'metrics-svc',
  'clickhouse',
];
const ops = [
  'GET',
  'POST',
  'SELECT',
  'INSERT',
  'SET',
  'validateToken',
  'aggregate',
  'query',
];

const sampleRows = Array.from({ length: 1000 }, (_, i) => {
  const level = i === 0 ? 0 : (i * 7) % 4;
  const childCount = level < 2 && i % 3 === 0 ? ((i * 3) % 5) + 1 : 0;
  const start = i * 3;
  const duration = 10 + ((i * 13) % 90);
  return makeRow(
    `s${i}`,
    services[i % services.length],
    `${ops[i % ops.length]} /op-${i}`,
    start,
    duration,
    level,
    childCount,
  );
});

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
