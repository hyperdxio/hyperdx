import type { Meta, StoryObj } from '@storybook/react';

import LandingHeader from './LandingHeader';

const meta = {
  component: LandingHeader,
} satisfies Meta<typeof LandingHeader>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    activeKey: 'activeKey',
  },
};
