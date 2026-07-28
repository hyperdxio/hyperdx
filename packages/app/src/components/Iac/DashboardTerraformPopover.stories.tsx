import type { Meta, StoryObj } from '@storybook/nextjs';

import DashboardTerraformPopover from './DashboardTerraformPopover';

const meta = {
  title: 'Components/Iac/DashboardTerraformPopover',
  component: DashboardTerraformPopover,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof DashboardTerraformPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

// Everything is derived synchronously from the id and name, so this story
// needs no MSW handlers.
export const Default: Story = {
  args: {
    dashboardId: '655b1b7d9143aa1b1b73f4f4',
    dashboardName: 'HyperDX Usage',
  },
};
