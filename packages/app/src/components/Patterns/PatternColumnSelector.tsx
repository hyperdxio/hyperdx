import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { Box } from '@mantine/core';

import SQLInlineEditor from '@/components/SQLEditor/SQLInlineEditor';
import { useSource } from '@/source';

export function buildPatternColumnExpression({
  patternColumn,
  fallback,
}: {
  patternColumn: string | null | undefined;
  fallback: string;
}): string {
  if (!patternColumn) return fallback;
  return `toString(${patternColumn})`;
}

export function PatternColumnSelector({
  sourceId,
  value,
  onChange,
  onSubmit,
  dateRange,
}: {
  sourceId: string | undefined;
  value: string;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  dateRange?: [Date, Date];
}) {
  const { data: source } = useSource({ id: sourceId });
  const tableConnection = tcFromSource(source);

  if (!onChange) return null;

  return (
    <Box py="xs" maw={600}>
      <SQLInlineEditor
        tableConnection={tableConnection}
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        enableHotkey
        label="Pattern Expression"
        placeholder="Default (body) — column name or expression"
        size="xs"
        allowMultiline={false}
        sourceId={sourceId}
        dateRange={dateRange}
      />
    </Box>
  );
}
