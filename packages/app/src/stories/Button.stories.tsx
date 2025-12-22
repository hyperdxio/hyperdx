import { Button, Group, Stack, Text } from '@mantine/core';
import type { Meta } from '@storybook/nextjs';
import {
  IconArrowRight,
  IconCheck,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';

const meta: Meta = {
  title: 'Components/Button',
  component: Button,
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
        <Button variant="primary">Primary</Button>
        <Button variant="primary" leftSection={<IconCheck size={16} />}>
          Confirm
        </Button>
        <Button variant="primary" rightSection={<IconArrowRight size={16} />}>
          Continue
        </Button>
        <Button variant="primary" disabled>
          Disabled
        </Button>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        Secondary
      </Text>
      <Group>
        <Button variant="secondary">Secondary</Button>
        <Button variant="secondary" leftSection={<IconPlus size={16} />}>
          Add Item
        </Button>
        <Button variant="secondary" disabled>
          Disabled
        </Button>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        Danger
      </Text>
      <Group>
        <Button variant="danger">Danger</Button>
        <Button variant="danger" leftSection={<IconTrash size={16} />}>
          Delete
        </Button>
        <Button variant="danger" disabled>
          Disabled
        </Button>
      </Group>
    </div>
  </Stack>
);

export const Sizes = () => (
  <Stack gap="md">
    <Text size="sm" fw={600}>
      Button Sizes
    </Text>
    <Group align="center">
      <Button variant="primary" size="xxs">
        XXS
      </Button>
      <Button variant="primary" size="xs">
        XS
      </Button>
      <Button variant="primary" size="sm">
        SM
      </Button>
      <Button variant="primary" size="md">
        MD
      </Button>
      <Button variant="primary" size="lg">
        LG
      </Button>
      <Button variant="primary" size="xl">
        XL
      </Button>
    </Group>
  </Stack>
);
