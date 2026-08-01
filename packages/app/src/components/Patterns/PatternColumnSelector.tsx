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
  bodyValueExpression,
}: {
  sourceId: string | undefined;
  value: string;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  dateRange?: [Date, Date];
  bodyValueExpression?: string;
}) {
  const { data: source } = useSource({ id: sourceId });
  const tableConnection = tcFromSource(source);

  if (!onChange) return null;

  const placeholder = bodyValueExpression
    ? `Default (${bodyValueExpression}) — column name or expression`
    : 'Default — column name or expression';

  return (
    <Box py="xs" maw={600}>
      <SQLInlineEditor
        tableConnection={tableConnection}
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        enableHotkey
        label="Pattern Expression"
        placeholder={placeholder}
        size="xs"
        allowMultiline={false}
        sourceId={sourceId}
        dateRange={dateRange}
      />
    </Box>
  );
}
