import { useState } from 'react';
import { Control, useWatch } from 'react-hook-form';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { ActionIcon, Box, Flex, Text, Tooltip } from '@mantine/core';
import { useDebouncedCallback, useDidUpdate } from '@mantine/hooks';
import { IconCheck } from '@tabler/icons-react';

import { ErrorCollapse } from '@/components/Error/ErrorCollapse';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import { useExplainQuery } from '@/hooks/useExplainQuery';

import { FormRow } from './FormRow';

export function OrderByFormRow({
  control,
  databaseName,
  tableName,
  connectionId,
}: {
  control: Control<TSource>;
  databaseName: string;
  tableName: string;
  connectionId: string;
}) {
  const orderByInput = useWatch({
    control,
    name: 'orderByExpression',
  });

  const [explainExpression, setExplainExpression] = useState<string>();

  const setExplainExpressionDebounced = useDebouncedCallback((expr: string) => {
    setExplainExpression(expr);
  }, 1_000);

  useDidUpdate(() => {
    setExplainExpressionDebounced(orderByInput ?? '');
  }, [orderByInput]);

  const {
    data: explainData,
    error: explainError,
    isLoading: explainLoading,
  } = useExplainQuery(
    {
      from: { databaseName, tableName },
      connection: connectionId,
      select: '*',
      where: '',
      orderBy: explainExpression,
    },
    {
      enabled: !!explainExpression,
    },
  );

  const runValidation = () => {
    setExplainExpression(orderByInput ?? '');
  };

  const isExpressionValid = !!explainData?.length;
  const isExpressionInvalid = explainError instanceof ClickHouseQueryError;

  const shouldShowResult =
    explainExpression === (orderByInput ?? '') &&
    !!explainExpression &&
    (isExpressionValid || isExpressionInvalid);

  return (
    <>
      <FormRow
        label="Default Order By"
        helpText="Custom ORDER BY expression that overrides the default ordering. Leave empty to use the auto-detected default. (This can be customized per search later)"
      >
        <Flex align="center" gap="sm">
          <Box flex={1}>
            <SQLInlineEditorControlled
              tableConnection={{
                databaseName,
                tableName,
                connectionId,
              }}
              control={control}
              name="orderByExpression"
              placeholder="e.g. Timestamp DESC"
              disableKeywordAutocomplete
            />
          </Box>
          <Tooltip label="Validate expression">
            <ActionIcon
              size="xs"
              variant="subtle"
              color="gray"
              loading={explainLoading}
              disabled={!orderByInput || explainLoading}
              onClick={runValidation}
            >
              <IconCheck size={16} />
            </ActionIcon>
          </Tooltip>
        </Flex>
        {shouldShowResult && (
          <Box>
            {isExpressionValid && (
              <Text c="green" size="xs">
                Expression is valid.
              </Text>
            )}
            {isExpressionInvalid && (
              <ErrorCollapse
                summary="Expression is invalid"
                details={explainError?.message}
              />
            )}
          </Box>
        )}
      </FormRow>
    </>
  );
}
