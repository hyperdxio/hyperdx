import { useMemo } from 'react';
import {
  ColumnMeta,
  convertCHDataTypeToJSType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { Box, Group, Select, Text } from '@mantine/core';

import { useColumns } from '@/hooks/useMetadata';
import { useSource } from '@/source';

export function buildPatternColumnExpression({
  patternColumn,
  fallback,
  columns,
}: {
  patternColumn: string | null | undefined;
  fallback: string;
  columns: ColumnMeta[] | undefined;
}): string {
  if (!patternColumn) return fallback;
  const col = columns?.find(c => c.name === patternColumn);
  if (!col) return patternColumn;
  const jsType = convertCHDataTypeToJSType(col.type);
  if (jsType === JSDataType.String) return patternColumn;
  return `toString(${patternColumn})`;
}

function useSourceColumns(sourceId: string | undefined) {
  const { data: source } = useSource({ id: sourceId });
  const tc = tcFromSource(source);
  return useColumns(tc, {
    enabled: !!tc.databaseName && !!tc.tableName && !!tc.connectionId,
  });
}

export function usePatternColumnExpression({
  sourceId,
  patternColumn,
  fallback,
}: {
  sourceId: string | undefined;
  patternColumn: string | null | undefined;
  fallback: string;
}): string {
  const { data: columns } = useSourceColumns(sourceId);
  return useMemo(
    () => buildPatternColumnExpression({ patternColumn, fallback, columns }),
    [patternColumn, fallback, columns],
  );
}

export function PatternColumnSelector({
  sourceId,
  patternColumn,
  onChange,
}: {
  sourceId: string | undefined;
  patternColumn: string | null | undefined;
  onChange?: (column: string | null) => void;
}) {
  const { data: columns } = useSourceColumns(sourceId);
  const options = useMemo(
    () => columns?.map(col => ({ value: col.name, label: col.name })) ?? [],
    [columns],
  );

  if (!onChange) return null;

  return (
    <Box py="xs">
      <Group gap="xs" align="center" wrap="nowrap">
        <Text size="xs" c="dimmed">
          Pattern Column
        </Text>
        <Select
          size="xs"
          searchable
          clearable
          value={patternColumn ?? null}
          onChange={onChange}
          data={options}
          placeholder="Default (body)"
          w={300}
          data-testid="pattern-column-select"
          comboboxProps={{ withinPortal: true }}
        />
      </Group>
    </Box>
  );
}
