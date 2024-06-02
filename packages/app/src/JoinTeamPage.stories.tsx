import type { Meta, StoryObj } from '@storybook/react';

import JoinTeamPage from './JoinTeamPage';

const meta = {
  component: JoinTeamPage,
} satisfies Meta<typeof JoinTeamPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
