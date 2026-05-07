import { Trans } from 'next-i18next/pages';
import { Button, Group, Stack, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';
import {
  IconArrowRight,
  IconCheck,
  IconExternalLink,
  IconLoader2,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'danger', 'link'],
    },
    size: {
      control: 'select',
      options: ['xxs', 'xs', 'sm', 'md', 'lg'],
    },
    disabled: {
      control: 'boolean',
    },
    loading: {
      control: 'boolean',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

// Interactive playground story
export const Playground: Story = {
  args: {
    children: 'Button',
    variant: 'primary',
    size: 'md',
    disabled: false,
    loading: false,
  },
};

export const CustomVariants = () => (
  <Stack gap="xl">
    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Primary</Trans>
      </Text>
      <Group>
        <Button variant="primary">
          <Trans>Primary</Trans>
        </Button>
        <Button variant="primary" leftSection={<IconCheck size={16} />}>
          <Trans>Confirm</Trans>
        </Button>
        <Button variant="primary" rightSection={<IconArrowRight size={16} />}>
          <Trans>Continue</Trans>
        </Button>
        <Button variant="primary" disabled>
          <Trans>Disabled</Trans>
        </Button>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Secondary</Trans>
      </Text>
      <Group>
        <Button variant="secondary">
          <Trans>Secondary</Trans>
        </Button>
        <Button variant="secondary" leftSection={<IconPlus size={16} />}>
          <Trans>Add Item</Trans>
        </Button>
        <Button variant="secondary" disabled>
          <Trans>Disabled</Trans>
        </Button>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Danger</Trans>
      </Text>
      <Group>
        <Button variant="danger">
          <Trans>Danger</Trans>
        </Button>
        <Button variant="danger" leftSection={<IconTrash size={16} />}>
          <Trans>Delete</Trans>
        </Button>
        <Button variant="danger" disabled>
          <Trans>Disabled</Trans>
        </Button>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Link</Trans>
      </Text>
      <Group>
        <Button variant="link">
          <Trans>Link</Trans>
        </Button>
        <Button variant="link" rightSection={<IconExternalLink size={16} />}>
          <Trans>View Details</Trans>
        </Button>
        <Button variant="link" disabled>
          <Trans>Disabled</Trans>
        </Button>
      </Group>
    </div>
  </Stack>
);

export const DisabledStates = () => (
  <Stack gap="xl">
    <Text size="lg" fw={700}>
      <Trans>Disabled Button States</Trans>
    </Text>
    <Text size="sm" c="dimmed">
      <Trans>
        All button variants should have a consistent disabled appearance with
        reduced opacity and a "not-allowed" cursor.
      </Trans>
    </Text>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Primary - Normal vs Disabled</Trans>
      </Text>
      <Group>
        <Button variant="primary">
          <Trans>Normal</Trans>
        </Button>
        <Button variant="primary" disabled>
          <Trans>Disabled</Trans>
        </Button>
        <Button variant="primary" leftSection={<IconCheck size={16} />}>
          <Trans>With Icon</Trans>
        </Button>
        <Button
          variant="primary"
          leftSection={<IconCheck size={16} />}
          disabled
        >
          <Trans>Disabled with Icon</Trans>
        </Button>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Secondary - Normal vs Disabled</Trans>
      </Text>
      <Group>
        <Button variant="secondary">
          <Trans>Normal</Trans>
        </Button>
        <Button variant="secondary" disabled>
          <Trans>Disabled</Trans>
        </Button>
        <Button variant="secondary" leftSection={<IconPlus size={16} />}>
          <Trans>With Icon</Trans>
        </Button>
        <Button
          variant="secondary"
          leftSection={<IconPlus size={16} />}
          disabled
        >
          <Trans>Disabled with Icon</Trans>
        </Button>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Danger - Normal vs Disabled</Trans>
      </Text>
      <Group>
        <Button variant="danger">
          <Trans>Normal</Trans>
        </Button>
        <Button variant="danger" disabled>
          <Trans>Disabled</Trans>
        </Button>
        <Button variant="danger" leftSection={<IconTrash size={16} />}>
          <Trans>With Icon</Trans>
        </Button>
        <Button variant="danger" leftSection={<IconTrash size={16} />} disabled>
          <Trans>Disabled with Icon</Trans>
        </Button>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Link - Normal vs Disabled</Trans>
      </Text>
      <Group>
        <Button variant="link">
          <Trans>Normal</Trans>
        </Button>
        <Button variant="link" disabled>
          <Trans>Disabled</Trans>
        </Button>
        <Button variant="link" rightSection={<IconExternalLink size={16} />}>
          <Trans>With Icon</Trans>
        </Button>
        <Button
          variant="link"
          rightSection={<IconExternalLink size={16} />}
          disabled
        >
          <Trans>Disabled with Icon</Trans>
        </Button>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>All Sizes - Disabled</Trans>
      </Text>
      <Group align="center">
        <Button variant="primary" size="xxs" disabled>
          <Trans>XXS</Trans>
        </Button>
        <Button variant="primary" size="xs" disabled>
          <Trans>XS</Trans>
        </Button>
        <Button variant="primary" size="sm" disabled>
          <Trans>SM</Trans>
        </Button>
        <Button variant="primary" size="md" disabled>
          <Trans>MD</Trans>
        </Button>
      </Group>
    </div>
  </Stack>
);

export const LoadingStates = () => (
  <Stack gap="xl">
    <Text size="lg" fw={700}>
      <Trans>Loading Button States</Trans>
    </Text>
    <Text size="sm" c="dimmed">
      <Trans>
        Buttons can show a loading spinner to indicate async operations.
      </Trans>
    </Text>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Loading Variants</Trans>
      </Text>
      <Group>
        <Button variant="primary" loading>
          <Trans>Primary Loading</Trans>
        </Button>
        <Button variant="secondary" loading>
          <Trans>Secondary Loading</Trans>
        </Button>
        <Button variant="danger" loading>
          <Trans>Danger Loading</Trans>
        </Button>
        <Button variant="link" loading>
          <Trans>Link Loading</Trans>
        </Button>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Custom Loading Indicator</Trans>
      </Text>
      <Group>
        <Button variant="primary" loading loaderProps={{ type: 'dots' }}>
          <Trans>Dots Loader</Trans>
        </Button>
        <Button
          variant="primary"
          leftSection={<IconLoader2 size={16} className="animate-spin" />}
        >
          <Trans>Custom Spinner</Trans>
        </Button>
      </Group>
    </div>
  </Stack>
);

export const Sizes = () => (
  <Stack gap="md">
    <Text size="sm" fw={600}>
      <Trans>Button Sizes</Trans>
    </Text>
    <Group align="center">
      <Button variant="primary" size="xxs">
        <Trans>XXS</Trans>
      </Button>
      <Button variant="primary" size="xs">
        <Trans>XS</Trans>
      </Button>
      <Button variant="primary" size="sm">
        <Trans>SM</Trans>
      </Button>
      <Button variant="primary" size="md">
        <Trans>MD</Trans>
      </Button>
    </Group>
  </Stack>
);
