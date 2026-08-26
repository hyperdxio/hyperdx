import { useMemo } from 'react';
import { UseControllerProps } from 'react-hook-form';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { MACRO_SUGGESTIONS } from '@hyperdx/common-utils/dist/macros';
import { QUERY_PARAMS_BY_DISPLAY_TYPE } from '@hyperdx/common-utils/dist/rawSqlParams';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { ActionIcon, Box, Group, Text, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconHelp } from '@tabler/icons-react';

import { SQL_PLACEHOLDERS } from '@/components/ChartEditor/constants';
import { RawSqlChartInstructions } from '@/components/ChartEditor/RawSqlChartInstructions';
import { SQLEditorControlled } from '@/components/SQLEditor/SQLEditor';
import { type SQLCompletion } from '@/components/SQLEditor/utils';

import styles from './QueryEditor.module.scss';

type ExploreRawSqlEditorProps = {
  /** Table connections offered for column/table autocomplete. */
  tableConnections: TableConnection[];
  /** Display type the query targets — drives placeholder, params, and help. */
  displayType?: DisplayType;
  dateRange?: [Date, Date];
  timestampValueExpression?: string;
  onSubmit?: () => void;
  /** Right-aligned controls on the help row (copy, reset, ...). */
  headerActions?: React.ReactNode;
  /** Fired when the user edits the text (not when it is set programmatically). */
  onValueChange?: (value: string) => void;
} & UseControllerProps<any>;

/**
 * Raw-SQL editor for the Explore page's SQL mode. Reuses the shared
 * `SQLEditorControlled` (ClickHouse dialect + column autocomplete) and layers
 * on macro/param completions (`$__sourceTable`, `$__filters`,
 * `{startDateMilliseconds:Int64}`, ...) plus a collapsible column-mapping
 * reference, mirroring the chart editor's raw-SQL experience.
 */
export function ExploreRawSqlEditor({
  tableConnections,
  displayType = DisplayType.Table,
  dateRange,
  timestampValueExpression,
  onSubmit,
  headerActions,
  onValueChange,
  ...controllerProps
}: ExploreRawSqlEditorProps) {
  const [instructionsOpen, { toggle: toggleInstructions }] =
    useDisclosure(false);

  const additionalCompletions = useMemo<SQLCompletion[]>(() => {
    const params = QUERY_PARAMS_BY_DISPLAY_TYPE[displayType] ?? [];

    const paramCompletions: SQLCompletion[] = params.map(({ name, type }) => ({
      label: `{${name}:${type}}`,
      // Omit the closing } because the editor auto-inserts it on {
      apply: `{${name}:${type}`,
      detail: 'param',
      type: 'variable',
    }));

    const macroCompletions: SQLCompletion[] = MACRO_SUGGESTIONS.map(
      ({ name, minArgs }) => ({
        label: `$__${name}`,
        apply: minArgs > 0 ? `$__${name}(` : `$__${name}`,
        detail: 'macro',
        type: 'function',
      }),
    );

    return [...paramCompletions, ...macroCompletions];
  }, [displayType]);

  return (
    <Box className={styles.sqlBody} data-testid="explore-raw-sql-editor">
      <Group gap="xs" align="center" mb={6} wrap="nowrap">
        <Tooltip label="Column mapping reference" withArrow position="top">
          <ActionIcon
            variant="subtle"
            size="sm"
            color="gray"
            aria-label="Toggle SQL reference"
            onClick={toggleInstructions}
          >
            <IconHelp size={16} />
          </ActionIcon>
        </Tooltip>
        <Text size="xs" c="dimmed">
          Write a full query with macros like{' '}
          <Text span ff="monospace" fz="xs">
            $__sourceTable
          </Text>{' '}
          and{' '}
          <Text span ff="monospace" fz="xs">
            $__filters
          </Text>
          .
        </Text>
        {headerActions != null && (
          <Group gap={4} ml="auto" wrap="nowrap" style={{ flexShrink: 0 }}>
            {headerActions}
          </Group>
        )}
      </Group>
      {instructionsOpen ? (
        <Box mb={6}>
          <RawSqlChartInstructions displayType={displayType} />
        </Box>
      ) : null}
      <SQLEditorControlled
        {...controllerProps}
        onValueChange={onValueChange}
        enableLineWrapping
        placeholder={SQL_PLACEHOLDERS[displayType]}
        tableConnections={tableConnections}
        additionalCompletions={additionalCompletions}
        dateRange={dateRange}
        timestampValueExpression={timestampValueExpression}
        onSubmit={onSubmit}
        height="160px"
      />
    </Box>
  );
}
