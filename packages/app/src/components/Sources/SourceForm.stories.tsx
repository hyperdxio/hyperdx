import { delay, http, HttpResponse } from 'msw';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Box, Card, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { TableSourceForm } from './SourceForm';

const API_URL = 'http://localhost:8000';

// Mock data
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

const mockDatabases = ['default', 'system', 'logs'];

const mockTables = [
  'otel_logs',
  'otel_traces',
  'otel_metrics_gauge',
  'otel_metrics_sum',
  'otel_metrics_histogram',
];

// MSW handlers for API mocking
const defaultHandlers = [
  http.get(`${API_URL}/team/connections`, () => {
    return HttpResponse.json(mockConnections);
  }),
  http.get(`${API_URL}/team/sources`, () => {
    return HttpResponse.json(mockSources);
  }),
  http.get(`${API_URL}/team/sources/:id`, ({ params }) => {
    const source = mockSources.find(s => s.id === params.id);
    if (source) {
      return HttpResponse.json(source);
    }
    return new HttpResponse(null, { status: 404 });
  }),
  http.get(`${API_URL}/clickhouse/databases`, () => {
    return HttpResponse.json(mockDatabases);
  }),
  http.get(`${API_URL}/clickhouse/tables`, () => {
    return HttpResponse.json(mockTables);
  }),
  http.post(`${API_URL}/team/sources`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ id: 'new-source-id', ...body });
  }),
  http.put(`${API_URL}/team/sources/:id`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(body);
  }),
  http.delete(`${API_URL}/team/sources/:id`, () => {
    return HttpResponse.json({ success: true });
  }),
];

const meta: Meta<typeof TableSourceForm> = {
  title: 'Components/Sources/SourceForm',
  component: TableSourceForm,
  parameters: {
    layout: 'padded',
    msw: {
      handlers: defaultHandlers,
    },
  },
  decorators: [
    Story => (
      <Card withBorder p="md" style={{ maxWidth: 900 }}>
        <Story />
      </Card>
    ),
  ],
  argTypes: {
    isNew: {
      control: 'boolean',
      description: 'Whether this is a new source (create mode)',
    },
    defaultName: {
      control: 'text',
      description: 'Default name for new sources',
    },
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

/** Create new source form */
export const CreateNew: Story = {
  name: 'Create New Source',
  args: {
    isNew: true,
    defaultName: 'My New Source',
    onCreate: () => {
      // Source created
    },
    onCancel: () => {
      // Cancelled
    },
  },
};

/** Edit existing source */
export const EditExisting: Story = {
  name: 'Edit Existing Source',
  args: {
    sourceId: 'source-logs',
    onSave: () => {
      // Saved
    },
  },
};

/** Create new source with pre-filled name */
export const CreateWithDefaultName: Story = {
  name: 'Create with Default Name',
  args: {
    isNew: true,
    defaultName: 'Application Logs',
    onCreate: () => {
      // Source created
    },
    onCancel: () => {
      // Cancelled
    },
  },
};

/** Loading state when connections are being fetched */
export const LoadingConnections: Story = {
  args: {
    isNew: true,
  },
  parameters: {
    msw: {
      handlers: [
        http.get(`${API_URL}/team/connections`, async () => {
          await delay('infinite');
          return HttpResponse.json([]);
        }),
        ...defaultHandlers.slice(1),
      ],
    },
  },
};

/** Form with no connections available */
export const NoConnections: Story = {
  name: 'No Connections Available',
  args: {
    isNew: true,
  },
  parameters: {
    msw: {
      handlers: [
        http.get(`${API_URL}/team/connections`, () => {
          return HttpResponse.json([]);
        }),
        ...defaultHandlers.slice(1),
      ],
    },
  },
  render: args => (
    <Box>
      <Text size="sm" c="dimmed" mb="md">
        Note: When no connections are available, users should be directed to
        create a connection first.
      </Text>
      <TableSourceForm {...args} />
    </Box>
  ),
};
