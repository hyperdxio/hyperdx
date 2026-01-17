import { delay, http, HttpResponse } from 'msw';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Box, Card, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { TableSourceForm } from './SourceForm';

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

// MSW handlers for API mocking (using named handlers for easy per-story overrides)
const defaultHandlers = {
  connections: http.get('*/api/connections', () => {
    return HttpResponse.json(mockConnections);
  }),
  sources: http.get('*/api/sources', () => {
    return HttpResponse.json(mockSources);
  }),
  sourceById: http.get('*/api/sources/:id', ({ params }) => {
    const source = mockSources.find(s => s.id === params.id);
    if (source) {
      return HttpResponse.json(source);
    }
    return new HttpResponse(null, { status: 404 });
  }),
  databases: http.get('*/api/clickhouse/databases', () => {
    return HttpResponse.json(mockDatabases);
  }),
  tables: http.get('*/api/clickhouse/tables', () => {
    return HttpResponse.json(mockTables);
  }),
  createSource: http.post('*/api/sources', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ id: 'new-source-id', ...body });
  }),
  updateSource: http.put('*/api/sources/:id', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(body);
  }),
  deleteSource: http.delete('*/api/sources/:id', () => {
    return HttpResponse.json({ success: true });
  }),
};

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
