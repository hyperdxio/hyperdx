import { Box, MantineSpacing, Text } from '@mantine/core';

import { ErrorCollapse } from '@/components/Error/ErrorCollapse';
import {
  TableConnectionLike,
  useExpressionValidation,
} from '@/hooks/useExpressionValidation';

export function ExpressionValidationStatus({
  expression,
  tableConnection,
  mt = 'xs',
}: {
  expression: string;
  tableConnection: TableConnectionLike;
  mt?: MantineSpacing;
}) {
  const { shouldShowResult, isInvalid, isValid, error } =
    useExpressionValidation({ expression, tableConnection });

  if (!shouldShowResult) {
    return null;
  }

  if (isInvalid) {
    return (
      <Box mt={mt}>
        <ErrorCollapse
          summary="Expression is invalid"
          details={error?.message}
        />
      </Box>
    );
  }

  if (isValid) {
    return (
      <Text c="green" size="xs" mt={mt}>
        Expression is valid.
      </Text>
    );
  }

  return null;
}
