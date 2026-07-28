import React from 'react';
import { ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Stack, Text } from '@mantine/core';
import { IconExclamationCircle } from '@tabler/icons-react';

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
  const { t } = useTranslation('common');
  const showRetry = allowReset || !!onRetry;

  return (
    <ReactErrorBoundary
      onError={error => {
        console.error(error);
      }}
      fallbackRender={({ error, resetErrorBoundary }) => (
        <Alert
          p="xs"
          color="red"
          icon={<IconExclamationCircle size={16} />}
          title={message || t('errors.generic')}
        >
          {(showErrorMessage || showRetry) && (
            <Stack align="flex-start" gap="xs">
              {showErrorMessage && <Text size="xs">{error.message}</Text>}
              {showRetry && (
                <Button
                  onClick={onRetry || resetErrorBoundary}
                  size="compact-xs"
                  variant="danger"
                >
                  {t('actions.retry')}
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
