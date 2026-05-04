import { Box, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { ErrorBoundary } from './ErrorBoundary';

// Component that throws an error for testing
const BuggyComponent = ({ shouldThrow = true }: { shouldThrow?: boolean }) => {
  if (shouldThrow) {
    throw new Error('This is a test error from BuggyComponent!');
  }
  return (
    <Box p="md">
      <Text>This component rendered successfully!</Text>
    </Box>
  );
};

const meta: Meta<typeof ErrorBoundary> = {
  title: 'Components/ErrorBoundary',
  component: ErrorBoundary,
  parameters: {
    layout: 'padded',
  },
  argTypes: {
    message: {
      control: 'text',
      description: 'Custom error message title',
    },
    showErrorMessage: {
      control: 'boolean',
      description: 'Whether to show the actual error message',
    },
    allowReset: {
      control: 'boolean',
      description: 'Whether to show a reset/retry button',
    },
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

/** Error caught with default message */
export const ErrorCaught: Story = {
  name: 'Error Caught (Default)',
  render: () => (
    <ErrorBoundary>
      <BuggyComponent shouldThrow />
    </ErrorBoundary>
  ),
};

/** Error caught with custom message */
export const CustomMessage: Story = {
  name: 'Error Caught (Custom Message)',
  render: () => (
    <ErrorBoundary message="Oops! Something broke.">
      <BuggyComponent shouldThrow />
    </ErrorBoundary>
  ),
};

/** Error caught showing the error details */
export const ShowErrorMessage: Story = {
  name: 'Show Error Message',
  render: () => (
    <ErrorBoundary showErrorMessage>
      <BuggyComponent shouldThrow />
    </ErrorBoundary>
  ),
};

/** Error caught with retry button */
export const WithRetryButton: Story = {
  name: 'With Retry Button',
  render: () => (
    <ErrorBoundary allowReset showErrorMessage>
      <BuggyComponent shouldThrow />
    </ErrorBoundary>
  ),
};

/** Error caught with custom retry handler */
export const WithCustomRetry: Story = {
  name: 'With Custom Retry Handler',
  render: () => (
    <ErrorBoundary
      showErrorMessage
      onRetry={() => alert('Custom retry handler called!')}
    >
      <BuggyComponent shouldThrow />
    </ErrorBoundary>
  ),
};

/** No error - normal render */
export const NoError: Story = {
  name: 'No Error (Normal Render)',
  render: () => (
    <ErrorBoundary>
      <BuggyComponent shouldThrow={false} />
    </ErrorBoundary>
  ),
};
