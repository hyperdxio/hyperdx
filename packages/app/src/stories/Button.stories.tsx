import { Button } from '@mantine/core';
import type { Meta } from '@storybook/nextjs';
import { IconStarFilled } from '@tabler/icons-react';

// Just a test story, can be deleted

const meta: Meta = {
  title: 'Button',
  component: Button,
  parameters: {
    layout: 'centered',
  },
};

export const Default = () => (
  <Button
    variant="light"
    leftSection={<IconStarFilled size={14} />}
    size="compact-sm"
  >
    Assign exception to Warren
  </Button>
);

export default meta;
