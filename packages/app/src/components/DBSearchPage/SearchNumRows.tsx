import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Text } from '@mantine/core';

import { useExplainQuery } from '@/hooks/useExplainQuery';

type SearchNumRowsProps = {
  config: ChartConfigWithDateRange;
  enabled: boolean;
};

export function SearchNumRows({ config, enabled }: SearchNumRowsProps) {
  const { data, isLoading, error } = useExplainQuery(config, {
    enabled,
  });

  if (!enabled) {
    return null;
  }

  const numRows = data?.[0]?.rows;
  return (
    <Text size="xs">
      {isLoading
        ? 'Scanned Rows ...'
        : error || !numRows
          ? ''
          : `Scanned Rows: ${Number.parseInt(numRows)?.toLocaleString()}`}
    </Text>
  );
}
