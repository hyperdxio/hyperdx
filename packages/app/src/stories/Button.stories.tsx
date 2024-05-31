import { Button } from '@mantine/core';
import type { Meta } from '@storybook/react';

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
    leftSection={<i className="bi bi-star-fill" />}
    size="compact-sm"
  >
    Assign exception to Warren
  </Button>
);

export default meta;
