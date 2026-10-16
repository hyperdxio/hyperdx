import { Link, Text } from '@clickhouse/click-ui';
import { Stack } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { ContactSupportText } from '@/components/ContactSupportText';

// Smoke test for the click-ui integration: the provider in ThemeWrapper must
// follow the Storybook theme toggle, and click-ui text must sit next to
// Mantine layout without either library's globals breaking the other.
const meta: Meta<typeof Link> = {
  title: 'Click UI/Link',
  component: Link,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    size: {
      control: 'select',
      options: ['xs', 'sm', 'md', 'lg'],
    },
    weight: {
      control: 'select',
      options: ['normal', 'medium', 'semibold', 'bold', 'mono'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Link>;

export const Playground: Story = {
  args: {
    children: 'Open the ClickHouse docs',
    href: 'https://clickhouse.com/docs',
    target: '_blank',
    size: 'md',
    weight: 'normal',
  },
};

export const WithIcon: Story = {
  args: {
    children: 'View in ClickHouse',
    href: 'https://clickhouse.com',
    target: '_blank',
    icon: 'popout',
  },
};

export const InErrorMessage: Story = {
  render: () => (
    <Stack gap="xs">
      <Text>
        An error occurred. <ContactSupportText />
      </Text>
    </Stack>
  ),
};
