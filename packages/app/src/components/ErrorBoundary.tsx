import React from 'react';
import { ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';
import { Alert, Button, Stack, Text } from '@mantine/core';

import { Icon } from './Icon';

type ErrorBoundaryProps = {
  children: React.ReactNode;
  message?: string;
  showErrorMessage?: boolean;
  allowReset?: boolean;
  onRetry?: () => void;
};

/**
 * A `react-error-boundary` wrapper with a predefined fallback component
 */
export const ErrorBoundary = ({
  children,
  onRetry,
  allowReset,
  showErrorMessage,
  message,
}: ErrorBoundaryProps) => {
  const showRetry = allowReset || !!onRetry;

  return (
    <ReactErrorBoundary
      onError={error => {
        console.error(error);
      }}
      fallbackRender={({ error, resetErrorBoundary }) => (
        <Alert
          p="xs"
          color="orange"
          icon={<Icon name="info-circle-fill" />}
          title={message || 'Something went wrong'}
        >
          {(showErrorMessage || showRetry) && (
            <Stack align="flex-start" gap="xs">
              {showErrorMessage && <Text size="xs">{error.message}</Text>}
              {showRetry && (
                <Button
                  onClick={onRetry || resetErrorBoundary}
                  size="compact-xs"
                  color="orange"
                >
                  Retry
                </Button>
              )}
            </Stack>
          )}
        </Alert>
      )}
    >
      {children}
    </ReactErrorBoundary>
  );
};
