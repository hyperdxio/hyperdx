import React from 'react';
import { http, HttpResponse } from 'msw';
import { Box } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';

import IacMigrationSection from './IacMigrationSection';

const meta = {
  title: 'Components/TeamSettings/IacMigrationSection',
  component: IacMigrationSection,
  parameters: {
    layout: 'padded',
    msw: {
      handlers: [
        http.get('*/api/iac/import-manifest', () =>
          HttpResponse.json({
            dashboards: [
              { id: '655b1b7d9143aa1b1b73f4f4', name: 'HyperDX Usage' },
              { id: '655b1b7d9143aa1b1b73f4f5', name: 'OTel Collectors' },
            ],
            alerts: [
              {
                id: '655b1b7d9143aa1b1b73f4f6',
                name: 'Too many errors',
                source: 'saved_search',
                savedSearchId: '655b1b7d9143aa1b1b73f4f7',
              },
              { id: '655b1b7d9143aa1b1b73f4f8', source: 'tile' },
            ],
            savedSearches: [
              { id: '655b1b7d9143aa1b1b73f4f7', name: 'Production errors' },
            ],
            sources: [{ id: '655b1b7d9143aa1b1b73f4f9', name: 'Logs' }],
            connections: [
              { id: '655b1b7d9143aa1b1b73f4fa', name: 'Local ClickHouse' },
            ],
            webhooks: [],
          }),
        ),
      ],
    },
  },
  decorators: [
    Story => (
      <Box maw={640}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof IacMigrationSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
