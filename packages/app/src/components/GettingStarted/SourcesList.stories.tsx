import { delay, http, HttpResponse } from 'msw';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Card } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { SourcesList } from './SourcesList';

const API_URL = 'http://localhost:8000';

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

const meta: Meta<typeof SourcesList> = {
  title: 'Components/GettingStarted/SourcesList',
  component: SourcesList,
  parameters: {
    layout: 'padded',
  },
  decorators: [
    Story => (
      <Card withBorder p="md" style={{ maxWidth: 800 }}>
        <Story />
      </Card>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof meta>;

/* Default with mock data (no API calls) */
export const Default: Story = {
  name: 'Default (Mock Data)',
  args: {
    mockSources,
    mockConnections,
  },
};

/* Loading State - simulates slow API */
export const Loading: Story = {
  name: 'Loading State',
  parameters: {
    msw: {
      handlers: [
        http.get(`${API_URL}/team/connections`, async () => {
          await delay('infinite');
          return HttpResponse.json([]);
        }),
        http.get(`${API_URL}/team/sources`, async () => {
          await delay('infinite');
          return HttpResponse.json([]);
        }),
      ],
    },
  },
};

/* Error State - simulates API failure */
export const Error: Story = {
  name: 'Error State',
  parameters: {
    msw: {
      handlers: [
        http.get(`${API_URL}/team/connections`, () => {
          return HttpResponse.json(
            { message: 'Failed to connect to database' },
            { status: 500 },
          );
        }),
        http.get(`${API_URL}/team/sources`, () => {
          return HttpResponse.json(
            { message: 'Failed to fetch sources' },
            { status: 500 },
          );
        }),
      ],
    },
  },
};

/* Empty State - no sources configured */
export const Empty: Story = {
  name: 'Empty (No Sources)',
  args: {
    mockSources: [],
    mockConnections: [],
  },
};
