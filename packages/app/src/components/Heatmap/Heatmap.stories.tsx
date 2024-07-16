import type { Meta, StoryObj } from '@storybook/react';

import { Heatmap } from './Heatmap';

const meta = {
  component: Heatmap,
} satisfies Meta<typeof Heatmap>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default = () => (
  <Heatmap
    xLabels={['Jun 1 20:20:200', 'Jun 10 20:20:200']}
    yLabels={['0ms', '30m']}
  />
);
