import { WebhookTemplateError } from '@hyperdx/common-utils/dist/core/handlebarsEnv';
import { Alert, Code } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

const errorTitle = ({ line, column }: WebhookTemplateError) => {
  if (line == null) return 'Template error';
  return column == null
    ? `Template error on line ${line}`
    : `Template error on line ${line}, column ${column}`;
};

export function WebhookBodyValidationAlert({
  error,
}: {
  error: WebhookTemplateError;
}) {
  return (
    <Alert
      variant="danger"
      icon={<IconAlertTriangle size={16} />}
      title={errorTitle(error)}
      data-testid="webhook-body-error"
    >
      <Code block>{error.message}</Code>
    </Alert>
  );
}
