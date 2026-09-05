import type { Meta, StoryObj } from '@storybook/nextjs';

import ResourceTerraformPopover from './ResourceTerraformPopover';

const meta = {
  title: 'Components/Iac/ResourceTerraformPopover',
  component: ResourceTerraformPopover,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ResourceTerraformPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

// Everything is derived synchronously from the ref, so these need no handlers.
export const Dashboard: Story = {
  args: {
    resource: {
      type: 'dashboard',
      id: '655b1b7d9143aa1b1b73f4f4',
      name: 'HyperDX Usage',
    },
  },
};

/** As rendered on the alerts page for a saved-search alert. */
export const SavedSearchAlert: Story = {
  args: {
    resource: {
      type: 'alert',
      id: '655b1b7d9143aa1b1b73f4f6',
      name: 'Too many errors',
    },
  },
};
