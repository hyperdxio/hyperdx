import { Trans } from 'next-i18next/pages';
import { ActionIcon, Group, Stack, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';
import {
  IconCheck,
  IconEdit,
  IconExternalLink,
  IconLoader2,
  IconPlus,
  IconSettings,
  IconTrash,
  IconX,
} from '@tabler/icons-react';

const meta: Meta<typeof ActionIcon> = {
  title: 'Components/ActionIcon',
  component: ActionIcon,
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
      options: ['xs', 'sm', 'md', 'lg', 'xl'],
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
type Story = StoryObj<typeof ActionIcon>;

// Interactive playground story
export const Playground: Story = {
  args: {
    children: <IconSettings size={18} />,
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
        <ActionIcon variant="primary" size="sm">
          <IconCheck size={16} />
        </ActionIcon>
        <ActionIcon variant="primary" size="md">
          <IconCheck size={18} />
        </ActionIcon>
        <ActionIcon variant="primary" size="lg">
          <IconCheck size={20} />
        </ActionIcon>
        <ActionIcon variant="primary" disabled>
          <IconCheck size={18} />
        </ActionIcon>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Secondary</Trans>
      </Text>
      <Group>
        <ActionIcon variant="secondary" size="sm">
          <IconEdit size={16} />
        </ActionIcon>
        <ActionIcon variant="secondary" size="md">
          <IconEdit size={18} />
        </ActionIcon>
        <ActionIcon variant="secondary" size="lg">
          <IconEdit size={20} />
        </ActionIcon>
        <ActionIcon variant="secondary" disabled>
          <IconEdit size={18} />
        </ActionIcon>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Danger</Trans>
      </Text>
      <Group>
        <ActionIcon variant="danger" size="sm">
          <IconTrash size={16} />
        </ActionIcon>
        <ActionIcon variant="danger" size="md">
          <IconTrash size={18} />
        </ActionIcon>
        <ActionIcon variant="danger" size="lg">
          <IconTrash size={20} />
        </ActionIcon>
        <ActionIcon variant="danger" disabled>
          <IconTrash size={18} />
        </ActionIcon>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Link</Trans>
      </Text>
      <Group>
        <ActionIcon variant="link" size="sm">
          <IconExternalLink size={16} />
        </ActionIcon>
        <ActionIcon variant="link" size="md">
          <IconExternalLink size={18} />
        </ActionIcon>
        <ActionIcon variant="link" size="lg">
          <IconExternalLink size={20} />
        </ActionIcon>
        <ActionIcon variant="link" disabled>
          <IconExternalLink size={18} />
        </ActionIcon>
      </Group>
    </div>
  </Stack>
);

export const Sizes = () => (
  <Stack gap="md">
    <Text size="sm" fw={600}>
      <Trans>ActionIcon Sizes</Trans>
    </Text>
    <Group align="center">
      <ActionIcon variant="primary" size="xs">
        <IconPlus size={14} />
      </ActionIcon>
      <ActionIcon variant="primary" size="sm">
        <IconPlus size={16} />
      </ActionIcon>
      <ActionIcon variant="primary" size="md">
        <IconPlus size={18} />
      </ActionIcon>
    </Group>
  </Stack>
);

export const DisabledStates = () => (
  <Stack gap="xl">
    <Text size="lg" fw={700}>
      <Trans>Disabled ActionIcon States</Trans>
    </Text>
    <Text size="sm" c="dimmed">
      <Trans>
        All ActionIcon variants should have a consistent disabled appearance
        with reduced opacity and a "not-allowed" cursor.
      </Trans>
    </Text>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Primary - Normal vs Disabled</Trans>
      </Text>
      <Group>
        <ActionIcon variant="primary" size="md">
          <IconCheck size={18} />
        </ActionIcon>
        <ActionIcon variant="primary" size="md" disabled>
          <IconCheck size={18} />
        </ActionIcon>
        <ActionIcon variant="primary" size="lg">
          <IconCheck size={20} />
        </ActionIcon>
        <ActionIcon variant="primary" size="lg" disabled>
          <IconCheck size={20} />
        </ActionIcon>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Secondary - Normal vs Disabled</Trans>
      </Text>
      <Group>
        <ActionIcon variant="secondary" size="md">
          <IconEdit size={18} />
        </ActionIcon>
        <ActionIcon variant="secondary" size="md" disabled>
          <IconEdit size={18} />
        </ActionIcon>
        <ActionIcon variant="secondary" size="lg">
          <IconEdit size={20} />
        </ActionIcon>
        <ActionIcon variant="secondary" size="lg" disabled>
          <IconEdit size={20} />
        </ActionIcon>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Danger - Normal vs Disabled</Trans>
      </Text>
      <Group>
        <ActionIcon variant="danger" size="md">
          <IconTrash size={18} />
        </ActionIcon>
        <ActionIcon variant="danger" size="md" disabled>
          <IconTrash size={18} />
        </ActionIcon>
        <ActionIcon variant="danger" size="lg">
          <IconTrash size={20} />
        </ActionIcon>
        <ActionIcon variant="danger" size="lg" disabled>
          <IconTrash size={20} />
        </ActionIcon>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Link - Normal vs Disabled</Trans>
      </Text>
      <Group>
        <ActionIcon variant="link" size="md">
          <IconExternalLink size={18} />
        </ActionIcon>
        <ActionIcon variant="link" size="md" disabled>
          <IconExternalLink size={18} />
        </ActionIcon>
        <ActionIcon variant="link" size="lg">
          <IconExternalLink size={20} />
        </ActionIcon>
        <ActionIcon variant="link" size="lg" disabled>
          <IconExternalLink size={20} />
        </ActionIcon>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Subtle - Normal vs Disabled</Trans>
      </Text>
      <Group>
        <ActionIcon variant="subtle" size="md">
          <IconSettings size={18} />
        </ActionIcon>
        <ActionIcon variant="subtle" size="md" disabled>
          <IconSettings size={18} />
        </ActionIcon>
        <ActionIcon variant="subtle" size="lg">
          <IconSettings size={20} />
        </ActionIcon>
        <ActionIcon variant="subtle" size="lg" disabled>
          <IconSettings size={20} />
        </ActionIcon>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>All Sizes - Disabled</Trans>
      </Text>
      <Group align="center">
        <ActionIcon variant="primary" size="xs" disabled>
          <IconPlus size={14} />
        </ActionIcon>
        <ActionIcon variant="primary" size="sm" disabled>
          <IconPlus size={16} />
        </ActionIcon>
        <ActionIcon variant="primary" size="md" disabled>
          <IconPlus size={18} />
        </ActionIcon>
        <ActionIcon variant="primary" size="lg" disabled>
          <IconPlus size={20} />
        </ActionIcon>
        <ActionIcon variant="primary" size="xl" disabled>
          <IconPlus size={22} />
        </ActionIcon>
      </Group>
    </div>
  </Stack>
);

export const LoadingStates = () => (
  <Stack gap="xl">
    <Text size="lg" fw={700}>
      <Trans>Loading ActionIcon States</Trans>
    </Text>
    <Text size="sm" c="dimmed">
      <Trans>
        ActionIcons can show a loading spinner to indicate async operations.
      </Trans>
    </Text>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Loading Variants</Trans>
      </Text>
      <Group>
        <ActionIcon variant="primary" loading>
          <IconCheck size={18} />
        </ActionIcon>
        <ActionIcon variant="secondary" loading>
          <IconEdit size={18} />
        </ActionIcon>
        <ActionIcon variant="danger" loading>
          <IconTrash size={18} />
        </ActionIcon>
        <ActionIcon variant="link" loading>
          <IconExternalLink size={18} />
        </ActionIcon>
        <ActionIcon variant="subtle" loading>
          <IconSettings size={18} />
        </ActionIcon>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Custom Loading Indicator</Trans>
      </Text>
      <Group>
        <ActionIcon variant="primary" loading loaderProps={{ type: 'dots' }}>
          <IconCheck size={18} />
        </ActionIcon>
        <ActionIcon variant="primary">
          <IconLoader2 size={18} className="animate-spin" />
        </ActionIcon>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        <Trans>Loading with Different Sizes</Trans>
      </Text>
      <Group align="center">
        <ActionIcon variant="primary" size="sm" loading>
          <IconCheck size={16} />
        </ActionIcon>
        <ActionIcon variant="primary" size="md" loading>
          <IconCheck size={18} />
        </ActionIcon>
        <ActionIcon variant="primary" size="lg" loading>
          <IconCheck size={20} />
        </ActionIcon>
      </Group>
    </div>
  </Stack>
);

export const CommonUseCases = () => (
  <Stack gap="md">
    <Text size="sm" fw={600}>
      <Trans>Common Use Cases</Trans>
    </Text>
    <Group>
      <ActionIcon variant="primary" aria-label="Confirm">
        <IconCheck size={18} />
      </ActionIcon>
      <ActionIcon variant="danger" aria-label="Cancel">
        <IconX size={18} />
      </ActionIcon>
      <ActionIcon variant="secondary" aria-label="Settings">
        <IconSettings size={18} />
      </ActionIcon>
      <ActionIcon variant="secondary" aria-label="Edit">
        <IconEdit size={18} />
      </ActionIcon>
      <ActionIcon variant="danger" aria-label="Delete">
        <IconTrash size={18} />
      </ActionIcon>
    </Group>
  </Stack>
);
