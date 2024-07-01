import type { Meta } from '@storybook/react';

import { ErrorBoundary } from './ErrorBoundary';

const meta: Meta = {
  title: 'ErrorBoundary',
  component: ErrorBoundary,
};

const BadComponent = () => {
  throw new Error('Error message');
};

export const Default = () => (
  <ErrorBoundary>
    <BadComponent />
  </ErrorBoundary>
);

export const WithRetry = () => (
  <ErrorBoundary onRetry={() => {}}>
    <BadComponent />
  </ErrorBoundary>
);

export const WithMessage = () => (
  <ErrorBoundary
    onRetry={() => {}}
    message="An error occurred while rendering the event details. Contact support
            for more help."
  >
    <BadComponent />
  </ErrorBoundary>
);

export const WithErrorMessage = () => (
  <ErrorBoundary onRetry={() => {}} message="Don't panic" showErrorMessage>
    <BadComponent />
  </ErrorBoundary>
);

export default meta;
