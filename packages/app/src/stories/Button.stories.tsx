import { Button, Group, Stack, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';
import {
  IconArrowRight,
  IconCheck,
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
      options: ['primary', 'secondary', 'danger'],
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

export const DisabledStates = () => (
  <Stack gap="xl">
    <Text size="lg" fw={700}>
      Disabled Button States
    </Text>
    <Text size="sm" c="dimmed">
      All button variants should have a consistent disabled appearance with
      reduced opacity and a &quot;not-allowed&quot; cursor.
    </Text>

    <div>
      <Text size="sm" fw={600} mb="xs">
        Primary - Normal vs Disabled
      </Text>
      <Group>
        <Button variant="primary">Normal</Button>
        <Button variant="primary" disabled>
          Disabled
        </Button>
        <Button variant="primary" leftSection={<IconCheck size={16} />}>
          With Icon
        </Button>
        <Button
          variant="primary"
          leftSection={<IconCheck size={16} />}
          disabled
        >
          Disabled with Icon
        </Button>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        Secondary - Normal vs Disabled
      </Text>
      <Group>
        <Button variant="secondary">Normal</Button>
        <Button variant="secondary" disabled>
          Disabled
        </Button>
        <Button variant="secondary" leftSection={<IconPlus size={16} />}>
          With Icon
        </Button>
        <Button
          variant="secondary"
          leftSection={<IconPlus size={16} />}
          disabled
        >
          Disabled with Icon
        </Button>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        Danger - Normal vs Disabled
      </Text>
      <Group>
        <Button variant="danger">Normal</Button>
        <Button variant="danger" disabled>
          Disabled
        </Button>
        <Button variant="danger" leftSection={<IconTrash size={16} />}>
          With Icon
        </Button>
        <Button variant="danger" leftSection={<IconTrash size={16} />} disabled>
          Disabled with Icon
        </Button>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        All Sizes - Disabled
      </Text>
      <Group align="center">
        <Button variant="primary" size="xxs" disabled>
          XXS
        </Button>
        <Button variant="primary" size="xs" disabled>
          XS
        </Button>
        <Button variant="primary" size="sm" disabled>
          SM
        </Button>
        <Button variant="primary" size="md" disabled>
          MD
        </Button>
      </Group>
    </div>
  </Stack>
);

export const LoadingStates = () => (
  <Stack gap="xl">
    <Text size="lg" fw={700}>
      Loading Button States
    </Text>
    <Text size="sm" c="dimmed">
      Buttons can show a loading spinner to indicate async operations.
    </Text>

    <div>
      <Text size="sm" fw={600} mb="xs">
        Loading Variants
      </Text>
      <Group>
        <Button variant="primary" loading>
          Primary Loading
        </Button>
        <Button variant="secondary" loading>
          Secondary Loading
        </Button>
        <Button variant="danger" loading>
          Danger Loading
        </Button>
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        Custom Loading Indicator
      </Text>
      <Group>
        <Button variant="primary" loading loaderProps={{ type: 'dots' }}>
          Dots Loader
        </Button>
        <Button
          variant="primary"
          leftSection={<IconLoader2 size={16} className="animate-spin" />}
        >
          Custom Spinner
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
    </Group>
  </Stack>
);
