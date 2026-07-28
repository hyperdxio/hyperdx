import React from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { TerraformHelperPanel } from './TerraformHelperPanel';
import { buildImportCommand, buildProviderBlock } from './terraformSnippets';

const meta = {
  title: 'Components/Iac/TerraformHelperPanel',
  component: TerraformHelperPanel,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <div style={{ maxWidth: 520 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TerraformHelperPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const ref = {
  type: 'dashboard' as const,
  id: '655b1b7d9143aa1b1b73f4f4',
  name: 'HyperDX Usage',
};

export const Default: Story = {
  args: {
    snippets: [
      { label: 'Import command', snippet: buildImportCommand(ref) },
      {
        label: 'Provider setup',
        collapsible: true,
        hint: 'Add once per Terraform module. Skip if your project already declares the ClickHouse provider.',
        snippet: buildProviderBlock('https://hyperdx.example.com/api'),
      },
    ],
  },
};
