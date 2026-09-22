import { Box, MantineSpacing, Text } from '@mantine/core';

import { ErrorCollapse } from '@/components/Error/ErrorCollapse';
import {
  TableConnectionLike,
  useExpressionValidation,
} from '@/hooks/useExpressionValidation';
import { isLiteralSqlExpression } from '@/utils/sqlLiteralExpression';

export function ExpressionValidationStatus({
  expression,
  tableConnection,
  mt = 'xs',
  warnOnLiteral = false,
}: {
  expression: string;
  tableConnection: TableConnectionLike;
  mt?: MantineSpacing;
  /**
   * Flag an expression that is a hard-coded value. ClickHouse accepts one, so
   * it validates clean, but for a field that identifies the row it is always a
   * misconfiguration.
   */
  warnOnLiteral?: boolean;
}) {
  const { shouldShowResult, isInvalid, isValid, error } =
    useExpressionValidation({ expression, tableConnection });

  if (shouldShowResult && isInvalid) {
    return (
      <Box mt={mt}>
        <ErrorCollapse
          summary="Expression is invalid"
          details={error?.message}
        />
      </Box>
    );
  }

  if (warnOnLiteral && isLiteralSqlExpression(expression)) {
    return (
      <Text variant="warning" size="xs" mt={mt}>
        This is a fixed value, not a column reference. Every row would report
        the same ID — point it at the column that holds it.
      </Text>
    );
  }

  if (shouldShowResult && isValid) {
    return (
      <Text variant="success" size="xs" mt={mt}>
        Expression is valid.
      </Text>
    );
  }

  return null;
}
