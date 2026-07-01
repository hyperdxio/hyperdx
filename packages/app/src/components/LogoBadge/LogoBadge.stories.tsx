import { FaJsSquare } from 'react-icons/fa';
import { SiDeno, SiGo, SiPython, SiRuby } from 'react-icons/si';
import { Group } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { LogoBadge } from './LogoBadge';

const meta = {
  title: 'Components/LogoBadge',
  component: LogoBadge,
  parameters: { layout: 'centered' },
  args: {
    size: 56,
    radius: 12,
  },
} satisfies Meta<typeof LogoBadge>;

export default meta;
type Story = StoryObj<typeof LogoBadge>;

export const Default: Story = {
  args: {
    children: <FaJsSquare size={28} color="#f7df1e" />,
  },
};

export const BrandLogos: Story = {
  render: args => (
    <Group gap={16}>
      <LogoBadge {...args}>
        <FaJsSquare size={28} color="#f7df1e" />
      </LogoBadge>
      <LogoBadge {...args}>
        <SiPython size={26} color="#3776ab" />
      </LogoBadge>
      <LogoBadge {...args}>
        <SiRuby size={24} color="#cc342d" />
      </LogoBadge>
      <LogoBadge {...args}>
        <SiGo size={30} color="#00add8" />
      </LogoBadge>
      <LogoBadge {...args}>
        <SiDeno size={26} color="#000000" />
      </LogoBadge>
    </Group>
  ),
};
