import { ActionIcon, Group, Stack, Text } from '@mantine/core';
import type { Meta } from '@storybook/nextjs';
import {
  IconCheck,
  IconEdit,
  IconPlus,
  IconSettings,
  IconTrash,
  IconX,
} from '@tabler/icons-react';

const meta: Meta = {
  title: 'Components/ActionIcon',
  component: ActionIcon,
  parameters: {
    layout: 'centered',
  },
};

export default meta;

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
      <ActionIcon variant="primary" size="lg">
        <IconPlus size={20} />
      </ActionIcon>
      <ActionIcon variant="primary" size="xl">
        <IconPlus size={24} />
      </ActionIcon>
    </Group>
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
