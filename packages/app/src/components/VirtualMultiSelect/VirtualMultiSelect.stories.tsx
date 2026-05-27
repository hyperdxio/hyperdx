import { useState } from 'react';
import { sample, times } from 'lodash';
import { Box } from '@mantine/core';
import { Meta, StoryObj } from '@storybook/nextjs';

import { VirtualMultiSelect } from './VirtualMultiSelect';

const regions = [
  'eu-central',
  'eu-central-eu-central',
  'eu-north',
  'eu-west',
  'eu-west',
];
const data = times(10_000, i => `${sample(regions)}-${i}`);

const meta: Meta<typeof VirtualMultiSelect> = {
  title: 'Components/VirtualMultiSelect',

  component: VirtualMultiSelect,

  parameters: {
    layout: 'centered',
  },

  args: {
    placeholder: 'regions',
    disabled: false,
  },

  argTypes: {
    data: { table: { disable: true } },
    values: { table: { disable: true } },
    onChange: { table: { disable: true } },
  },

  decorators: [
    (Story, ctx) => {
      const [values, onChange] = useState<string[]>([]);
      return (
        <Box maw={128}>
          <Story args={{ ...ctx.args, data, values, onChange }} />
        </Box>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof VirtualMultiSelect>;

export const Primary: Story = {};
