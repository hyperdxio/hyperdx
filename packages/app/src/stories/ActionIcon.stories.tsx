import { ActionIcon, Group, Stack, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';
import {
  IconCheck,
  IconEdit,
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
      options: ['primary', 'secondary', 'danger'],
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
        Primary
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
        Secondary
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
        Danger
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
  </Stack>
);

export const Sizes = () => (
  <Stack gap="md">
    <Text size="sm" fw={600}>
      ActionIcon Sizes
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
      Disabled ActionIcon States
    </Text>
    <Text size="sm" c="dimmed">
      All ActionIcon variants should have a consistent disabled appearance with
      reduced opacity and a &quot;not-allowed&quot; cursor.
    </Text>

    <div>
      <Text size="sm" fw={600} mb="xs">
        Primary - Normal vs Disabled
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
        Secondary - Normal vs Disabled
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
        Danger - Normal vs Disabled
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
        Subtle - Normal vs Disabled
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
        All Sizes - Disabled
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
      Loading ActionIcon States
    </Text>
    <Text size="sm" c="dimmed">
      ActionIcons can show a loading spinner to indicate async operations.
    </Text>

    <div>
      <Text size="sm" fw={600} mb="xs">
        Loading Variants
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
        <ActionIcon variant="subtle" loading>
          <IconSettings size={18} />
        </ActionIcon>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        Custom Loading Indicator
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
        Loading with Different Sizes
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
      Common Use Cases
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
