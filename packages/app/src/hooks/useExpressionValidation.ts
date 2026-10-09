import { useCallback, useState } from 'react';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { getSourceTable } from '@hyperdx/common-utils/dist/core/metadata';
import { SourceLike } from '@hyperdx/common-utils/dist/types';
import { useDebouncedCallback, useDidUpdate } from '@mantine/hooks';

import { useExplainQuery } from '@/hooks/useExplainQuery';

export function useExpressionValidation({
  expression,
  alias,
  source,
  debounceMs = 1000,
}: {
  expression: string | undefined;
  alias?: string;
  source: SourceLike;
  debounceMs?: number;
}) {
  const [explainParams, setExplainParams] = useState<{
    expression?: string;
    alias?: string;
  }>();

  const setExplainParamsDebounced = useDebouncedCallback(
    (params: { expression?: string; alias?: string }) => {
      setExplainParams(params);
    },
    debounceMs,
  );

  useDidUpdate(() => {
    setExplainParamsDebounced({ expression, alias });
  }, [expression, alias]);

  const { databaseName, tableName, connectionId } = getSourceTable({ source });

  const { data, error, isLoading } = useExplainQuery(
    {
      from: { databaseName, tableName },
      connection: connectionId,
      select: [
        {
          alias: explainParams?.alias,
          valueExpression: explainParams?.expression ?? '',
        },
      ],
      where: '',
    },
    {
      enabled: !!explainParams?.expression,
    },
  );

  const isValid = !!data?.length;

  const isInvalid = error instanceof ClickHouseQueryError;

  const matchesCurrentInput =
    explainParams?.expression === expression && explainParams?.alias === alias;

  const shouldShowResult = matchesCurrentInput && (isValid || isInvalid);

  const validateNow = useCallback(() => {
    setExplainParams({ expression, alias });
  }, [expression, alias]);

  return {
    isValid,
    isInvalid,
    isLoading,
    error,
    shouldShowResult,
    validateNow,
  };
}
