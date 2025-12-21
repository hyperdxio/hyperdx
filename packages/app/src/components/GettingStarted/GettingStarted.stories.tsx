import React from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { GettingStarted } from './GettingStarted';

const meta = {
  title: 'Components/GettingStarted',
  component: GettingStarted,
  parameters: {
    layout: 'padded',
  },
  argTypes: {
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
  },
} satisfies Meta<typeof GettingStarted>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    endpoint: 'https://xz0bwno7ub.us-east1.gcp.clickhouse-dev.com',
    apiKey: 'ck_abc123xyz789secretkey',
    systemStatus: {
      storageReady: true,
      telemetryEndpointsReady: true,
      dataReceived: true,
    },
  },
};

export const AllSystemsReady: Story = {
  args: {
    endpoint: 'https://production.clickhouse.cloud',
    apiKey: 'ck_prod_super_secret_api_key_12345',
    systemStatus: {
      storageReady: true,
      telemetryEndpointsReady: true,
      dataReceived: true,
    },
  },
};

export const WaitingForData: Story = {
  args: {
    endpoint: 'https://staging.clickhouse.cloud',
    apiKey: 'ck_staging_api_key_67890',
    systemStatus: {
      storageReady: true,
      telemetryEndpointsReady: true,
      dataReceived: false,
    },
  },
};

export const InitialSetup: Story = {
  args: {
    endpoint: 'https://new-instance.clickhouse.cloud',
    apiKey: 'ck_new_api_key_abcdef',
    systemStatus: {
      storageReady: false,
      telemetryEndpointsReady: false,
      dataReceived: false,
    },
  },
};

export const PartiallyReady: Story = {
  args: {
    endpoint: 'https://partial.clickhouse.cloud',
    apiKey: 'ck_partial_api_key_xyz',
    systemStatus: {
      storageReady: true,
      telemetryEndpointsReady: false,
      dataReceived: false,
    },
  },
};
