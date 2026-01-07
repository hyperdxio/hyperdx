import { delay, http, HttpResponse } from 'msw';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Box } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { SourcesList } from './SourcesList';

const mockConnections = [
  {
    id: 'conn-1',
    name: 'Local ClickHouse',
    host: 'localhost:8123',
    username: 'default',
  },
];

const mockSources = [
  {
    id: 'source-logs',
    name: 'Logs',
    kind: SourceKind.Log,
    connection: 'conn-1',
    from: { databaseName: 'default', tableName: 'otel_logs' },
    timestampValueExpression: 'Timestamp',
  },
  {
    id: 'source-traces',
    name: 'Traces',
    kind: SourceKind.Trace,
    connection: 'conn-1',
    from: { databaseName: 'default', tableName: 'otel_traces' },
    timestampValueExpression: 'Timestamp',
  },
];

// Default handlers that return mock data
const defaultHandlers = {
  connections: http.get('*/api/connections', () => {
    return HttpResponse.json(mockConnections);
  }),
  sources: http.get('*/api/sources', () => {
    return HttpResponse.json(mockSources);
  }),
};

const meta: Meta<typeof SourcesList> = {
  title: 'Components/Sources/SourcesList',
  component: SourcesList,
  parameters: {
    layout: 'padded',
    msw: {
      handlers: defaultHandlers,
    },
  },
  decorators: [
    Story => (
      <Box style={{ maxWidth: 800 }}>
        <Story />
      </Box>
    ),
  ],
  argTypes: {
    variant: {
      control: 'select',
      options: ['compact', 'default'],
      description: 'Visual variant for text/icon sizing',
    },
    withCard: {
      control: 'boolean',
      description: 'Whether to wrap in a Card component',
    },
    withBorder: {
      control: 'boolean',
      description: 'Whether the card has a border',
    },
    showEmptyState: {
      control: 'boolean',
      description: 'Whether to show empty state UI',
    },
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

/* Default with mock data - compact variant (for GettingStarted) */
export const Default: Story = {
  name: 'Compact Variant (GettingStarted)',
  args: {
    variant: 'compact',
    withCard: true,
    withBorder: true,
  },
};

/* Default variant (for TeamPage) */
export const DefaultVariant: Story = {
  name: 'Default Variant (TeamPage)',
  args: {
    variant: 'default',
    withCard: true,
    withBorder: false,
    showEmptyState: false,
  },
};

/* Loading State - simulates slow API */
export const Loading: Story = {
  name: 'Loading State',
  parameters: {
    msw: {
      handlers: {
        connections: http.get('*/api/connections', async () => {
          await delay('infinite');
          return HttpResponse.json([]);
        }),
        sources: http.get('*/api/sources', async () => {
          await delay('infinite');
          return HttpResponse.json([]);
        }),
      },
    },
  },
};

/* Error State - simulates API failure */
export const Error: Story = {
  name: 'Error State',
  parameters: {
    msw: {
      handlers: {
        connections: http.get('*/api/connections', () => {
          return HttpResponse.json(
            { message: 'Failed to connect to database' },
            { status: 500 },
          );
        }),
        sources: http.get('*/api/sources', () => {
          return HttpResponse.json(
            { message: 'Failed to fetch sources' },
            { status: 500 },
          );
        }),
      },
    },
  },
};

/* Empty State - no sources configured */
export const Empty: Story = {
  name: 'Empty (No Sources)',
  args: {
    showEmptyState: true,
  },
  parameters: {
    msw: {
      handlers: {
        connections: http.get('*/api/connections', () => {
          return HttpResponse.json([]);
        }),
        sources: http.get('*/api/sources', () => {
          return HttpResponse.json([]);
        }),
      },
    },
  },
};
