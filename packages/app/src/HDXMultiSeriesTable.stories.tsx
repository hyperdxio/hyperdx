import React from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { Table } from './HDXMultiSeriesTableChart';

const columns = [
  { id: 'service', dataKey: 'ServiceName', displayName: 'Service' },
  { id: 'count', dataKey: 'Count', displayName: 'Count' },
  { id: 'p95', dataKey: 'P95', displayName: 'p95 (ms)' },
];

const data = Array.from({ length: 18 }, (_, i) => ({
  ServiceName: `service-${i + 1}`,
  Count: (i + 1) * 137,
  P95: 40 + i * 11,
}));

// Fixed-size frame so the virtual list renders rows and the sticky header
// has content to scroll over, surfacing the header separator.
const meta: Meta<typeof Table> = {
  title: 'HDXMultiSeriesTableChart',
  component: Table,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <div style={{ height: 320, width: 640 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    data,
    columns,
    sorting: [],
    onSortingChange: () => {},
  },
};

export default meta;

type Story = StoryObj<typeof Table>;

// Header separator only; rows share the body background.
export const Plain: Story = {
  args: { alternateRowBackground: false },
};

// Zebra striping on odd rows plus the always-on header separator.
export const Striped: Story = {
  args: { alternateRowBackground: true },
};

// Striped rows that also resolve to a click destination, so the stronger
// hover background can be checked over a stripe.
export const StripedWithRowActions: Story = {
  args: {
    alternateRowBackground: true,
    getRowAction: (row: { ServiceName: string }) => ({
      url: `/search?service=${row.ServiceName}`,
      description: `Search ${row.ServiceName}`,
    }),
  },
};
