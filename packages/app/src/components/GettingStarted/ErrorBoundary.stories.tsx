import React from 'react';
import { Alert, Card, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';
import { IconAlertTriangle } from '@tabler/icons-react';

import { GettingStartedErrorBoundary } from './ErrorBoundary';

// Component that throws an error
const BuggyComponent = ({ shouldThrow = true }: { shouldThrow?: boolean }) => {
  if (shouldThrow) {
    throw new Error('This is a simulated error for testing the error boundary');
  }
  return (
    <Card withBorder p="md">
      <Text>This component rendered successfully!</Text>
    </Card>
  );
};

const meta: Meta<typeof GettingStartedErrorBoundary> = {
  title: 'Components/GettingStarted/ErrorBoundary',
  component: GettingStartedErrorBoundary,
  parameters: {
    layout: 'padded',
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

/* Error Caught - shows error UI */
export const ErrorCaught: Story = {
  name: 'Error Caught',
  render: () => (
    <GettingStartedErrorBoundary>
      <BuggyComponent shouldThrow={true} />
    </GettingStartedErrorBoundary>
  ),
};

/* No Error - renders children normally */
export const NoError: Story = {
  name: 'No Error (Normal Render)',
  render: () => (
    <GettingStartedErrorBoundary>
      <BuggyComponent shouldThrow={false} />
    </GettingStartedErrorBoundary>
  ),
};

/* Custom Fallback UI */
export const CustomFallback: Story = {
  name: 'Custom Fallback UI',
  render: () => (
    <GettingStartedErrorBoundary
      fallback={
        <Alert
          icon={<IconAlertTriangle size={16} />}
          title="Custom error fallback"
          color="red"
          variant="light"
        >
          Something went terribly wrong! Please contact support.
        </Alert>
      }
    >
      <BuggyComponent shouldThrow={true} />
    </GettingStartedErrorBoundary>
  ),
};
