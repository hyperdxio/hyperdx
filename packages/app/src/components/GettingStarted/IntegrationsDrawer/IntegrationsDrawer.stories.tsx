import { type ComponentProps, useState } from 'react';
import { Button } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { IntegrationsDrawer } from './IntegrationsDrawer';

const SAMPLE_ENDPOINT = 'https://in-otel.hyperdx.io:4318';
const SAMPLE_API_KEY = 'a1b2c3d4-0000-0000-0000-abcdef123456';

const meta = {
  title: 'Components/GettingStarted/IntegrationsDrawer',
  component: IntegrationsDrawer,
  parameters: { layout: 'centered' },
  args: {
    endpoint: SAMPLE_ENDPOINT,
    apiKey: SAMPLE_API_KEY,
    initialCategory: 'all',
  },
  argTypes: {
    initialCategory: {
      control: 'select',
      options: [
        'all',
        'languages',
        'frameworks',
        'infrastructure',
        'cloud',
        'collectors',
      ],
    },
    opened: { control: false },
    onClose: { control: false },
  },
} satisfies Meta<typeof IntegrationsDrawer>;

export default meta;
type Story = StoryObj<typeof IntegrationsDrawer>;

/**
 * The drawer is prop-driven; this wrapper supplies the open/close state so it
 * can be toggled from the story, mirroring how the getting-started page uses it.
 */
function DrawerHarness({
  initialOpened = false,
  ...args
}: ComponentProps<typeof IntegrationsDrawer> & { initialOpened?: boolean }) {
  const [opened, setOpened] = useState(initialOpened);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpened(true)}>
        Send data to ClickStack
      </Button>
      <IntegrationsDrawer
        {...args}
        opened={opened}
        onClose={() => setOpened(false)}
      />
    </>
  );
}

export const Default: Story = {
  render: args => <DrawerHarness {...args} />,
};

/** Opens straight into the drawer for visual review of the grid + search. */
export const Opened: Story = {
  render: args => <DrawerHarness {...args} initialOpened />,
};

/** Deep-links to a single category chip (e.g. from a "Collectors" entry point). */
export const CollectorsCategory: Story = {
  args: { initialCategory: 'collectors' },
  render: args => <DrawerHarness {...args} initialOpened />,
};
