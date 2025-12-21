import React from 'react';
import {
  Connection,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { GettingStarted } from './GettingStarted';

// Mock data for sources and connections
const mockConnections: Connection[] = [
  {
    id: 'conn-1',
    name: 'Local ClickHouse',
    host: 'localhost:8123',
    username: 'default',
  },
];

const mockSources: TSource[] = [
  {
    id: 'source-logs',
    name: 'Logs',
    kind: SourceKind.Log,
    connection: 'conn-1',
    from: {
      databaseName: 'default',
      tableName: 'otel_logs',
    },
    timestampValueExpression: 'Timestamp',
  },
  {
    id: 'source-traces',
    name: 'Traces',
    kind: SourceKind.Trace,
    connection: 'conn-1',
    from: {
      databaseName: 'default',
      tableName: 'otel_traces',
    },
    timestampValueExpression: 'Timestamp',
  },
  {
    id: 'source-metrics',
    name: 'Metrics',
    kind: SourceKind.Metric,
    connection: 'conn-1',
    from: {
      databaseName: 'default',
      tableName: '',
    },
    timestampValueExpression: 'Timestamp',
  },
  {
    id: 'source-sessions',
    name: 'Sessions',
    kind: SourceKind.Session,
    connection: 'conn-1',
    from: {
      databaseName: 'default',
      tableName: 'hyperdx_sessions',
    },
    timestampValueExpression: 'Timestamp',
  },
];

const meta = {
  title: 'Components/GettingStarted',
  component: GettingStarted,
  parameters: {
    layout: 'padded',
  },
  args: {
    mockSources,
    mockConnections,
  },
  argTypes: {
    activeStep: {
      control: { type: 'radio' },
      options: [1, 2],
      description: 'The currently active step',
    },
    endpoint: {
      control: 'text',
      description: 'The endpoint URL to display',
    },
    apiKey: {
      control: 'text',
      description: 'The API key (shown masked by default)',
    },
    docsUrl: {
      control: 'text',
      description: 'URL to the documentation',
    },
    systemStatus: {
      control: 'object',
      description: 'System status indicators',
    },
    onConfigureDataSources: {
      action: 'onConfigureDataSources',
      description: 'Callback when "Configure data sources" button is clicked',
    },
    onConfirmAndExplore: {
      action: 'onConfirmAndExplore',
      description: 'Callback when "Confirm and explore" button is clicked',
    },
  },
} satisfies Meta<typeof GettingStarted>;

export default meta;

type Story = StoryObj<typeof meta>;

/* Step 1 Stories */
export const Step1Default: Story = {
  name: 'Step 1: Default',
  args: {
    activeStep: 1,
    endpoint: 'https://xz0bwno7ub.us-east1.gcp.clickhouse-dev.com',
    apiKey: 'ck_abc123xyz789secretkey',
    systemStatus: {
      storageReady: true,
      telemetryEndpointsReady: true,
      dataReceived: true,
    },
  },
};

export const Step1WaitingForData: Story = {
  name: 'Step 1: Waiting for Data',
  args: {
    activeStep: 1,
    endpoint: 'https://staging.clickhouse.cloud',
    apiKey: 'ck_staging_api_key_67890',
    systemStatus: {
      storageReady: true,
      telemetryEndpointsReady: true,
      dataReceived: false,
    },
  },
};

export const Step1InitialSetup: Story = {
  name: 'Step 1: Initial Setup',
  args: {
    activeStep: 1,
    endpoint: 'https://new-instance.clickhouse.cloud',
    apiKey: 'ck_new_api_key_abcdef',
    systemStatus: {
      storageReady: false,
      telemetryEndpointsReady: false,
      dataReceived: false,
    },
  },
};

/* Step 2 Stories */
export const Step2ConfigureDataSources: Story = {
  name: 'Step 2: Configure Data Sources',
  args: {
    activeStep: 2,
    endpoint: 'https://xz0bwno7ub.us-east1.gcp.clickhouse-dev.com',
    apiKey: 'ck_abc123xyz789secretkey',
  },
};
