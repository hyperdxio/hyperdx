import { useCallback, useMemo } from 'react';
import { FieldPath, useController, UseControllerProps } from 'react-hook-form';
import { TableConnectionChoice } from '@hyperdx/common-utils/dist/core/metadata';
import {
  BuilderChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';
import { ActionIcon, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconHelp } from '@tabler/icons-react';

import SyntaxReferenceModal from '@/components/SearchInput/SyntaxReferenceModal';
import { useMultipleAllFields } from '@/hooks/useMetadata';
import type { FilterStateHook } from '@/searchFilters';
import { useSource } from '@/source';

import { ExploreRawSqlEditor } from './ExploreRawSqlEditor';
import { FilterExpression } from './FilterExpression';
import {
  filterStateToExpression,
  lastClause,
  removeFilterClause,
} from './filterExpressionModel';
import { promoteWhereToFilters } from './promoteWhereToFilters';
import { QueryConfigMode, QueryEditor, QueryLanguage } from './QueryEditor';
import { QueryEditorToolbar } from './QueryEditorToolbar';
import { getExploreWhereLanguage } from './queryModeSafety';
import { useExploreQueryMode } from './useExploreQueryMode';

export type ExploreQueryEditorProps = {
  onSubmit?: () => void;
  enableHotkey?: boolean;
  dateRange?: [Date, Date];
  sourceId?: string;
  additionalSuggestions?: string[];
  /** Form field name for the language value; defaults to `${name}Language`. */
  languageName?: string;
  /** Right-aligned header controls (time picker, Live, Run, ...). */
  controls?: React.ReactNode;
  /**
   * Map of DateTime/Date column name → ClickHouse type. Filter pill values for
   * these columns are formatted to the user's locale/timezone.
   */
  dateTimeColumns?: ReadonlyMap<string, string>;
  /**
   * Query authoring mode. When provided, a Search | Raw SQL toggle is shown; in
   * `'sql'` mode the WHERE editor is swapped for a raw-SQL editor bound to
   * `sqlTemplateName`.
   */
  queryMode?: QueryConfigMode;
  onQueryModeChange?: (mode: QueryConfigMode) => void;
  /** Form field name for the raw-SQL template (SQL mode). */
  sqlTemplateName?: string;
  /** Display type the raw-SQL query targets (drives macros/placeholder/help). */
  rawSqlDisplayType?: DisplayType;
  searchFilters?: FilterStateHook;
  chartConfig?: BuilderChartConfigWithDateRange;
  'data-testid'?: string;
} & TableConnectionChoice &
  UseControllerProps<any>;

/**
 * Explore-only query editor. Wraps the presentational QueryEditor with
 * react-hook-form wiring, the ClickHouse field list for autocomplete, and the
 * shared syntax-reference modal. Kept separate from SearchWhereInput so the
 * Explore layout can evolve without affecting the Search page.
 */
export function ExploreQueryEditor({
  tableConnection,
  tableConnections,
  control,
  name,
  onSubmit,
  enableHotkey,
  dateRange,
  sourceId,
  additionalSuggestions,
  languageName = `${name}Language`,
  controls,
  dateTimeColumns,
  queryMode,
  onQueryModeChange,
  sqlTemplateName = 'sqlTemplate',
  rawSqlDisplayType = DisplayType.Table,
  searchFilters,
  chartConfig,
  'data-testid': dataTestId,
}: ExploreQueryEditorProps) {
  const [syntaxRefOpened, { open: openSyntaxRef, close: closeSyntaxRef }] =
    useDisclosure(false);

  const { field: valueField } = useController({
    control,
    name: name as FieldPath<any>,
  });
  const { field: languageField } = useController({
    control,
    name: languageName as FieldPath<any>,
  });
  const { field: sqlTemplateField } = useController({
    control,
    name: sqlTemplateName as FieldPath<any>,
  });

  const _tableConnections = tableConnection
    ? [tableConnection]
    : tableConnections;
  const { data: source } = useSource({ id: sourceId });
  const { data: fields } = useMultipleAllFields(_tableConnections ?? [], {
    dateRange,
    timestampValueExpression: source?.timestampValueExpression,
  });

  const language: QueryLanguage =
    languageField.value ?? getExploreWhereLanguage(source?.kind);

  const stringValue =
    typeof valueField.value === 'string' ? valueField.value : '';
  const sqlTemplateValue =
    typeof sqlTemplateField.value === 'string' ? sqlTemplateField.value : '';

  const { onModeChange } = useExploreQueryMode({
    language,
    where: stringValue,
    sqlTemplate: sqlTemplateValue,
    queryMode,
    sourceKind: source?.kind,
    onLanguageChange: languageField.onChange,
    onWhereChange: valueField.onChange,
    onQueryModeChange,
  });

  const identifiers = useMemo(() => {
    return [
      ...(fields?.map(c =>
        c.path.length > 1 ? `${c.path[0]}['${c.path[1]}']` : c.path[0],
      ) ?? []),
      ...(additionalSuggestions ?? []),
    ];
  }, [fields, additionalSuggestions]);

  const handleRemoveLastFilter = useCallback(() => {
    if (searchFilters == null) {
      return false;
    }
    const clause = lastClause(filterStateToExpression(searchFilters.filters));
    if (clause == null) {
      return false;
    }
    return removeFilterClause(clause, searchFilters);
  }, [searchFilters]);

  const ingestWhere = useCallback(
    (next: string, commitTrailing: boolean) => {
      if (searchFilters == null) {
        valueField.onChange(next);
        return;
      }
      const result = promoteWhereToFilters(next, language, { commitTrailing });
      const hasClauses = Object.values(result.filters).some(
        sel =>
          sel.included.size > 0 || sel.excluded.size > 0 || sel.range != null,
      );
      if (hasClauses) {
        searchFilters.mergeFilterValues(result.filters);
      }
      valueField.onChange(result.remainder);
    },
    [language, searchFilters, valueField],
  );

  const handleSubmit = useCallback(() => {
    ingestWhere(stringValue, true);
    onSubmit?.();
  }, [ingestWhere, onSubmit, stringValue]);

  return (
    <>
      <SyntaxReferenceModal
        opened={syntaxRefOpened}
        onClose={closeSyntaxRef}
        language={language}
      />
      <QueryEditor
        value={stringValue}
        onChange={next => ingestWhere(next, next !== next.trimEnd())}
        language={language}
        onLanguageChange={languageField.onChange}
        languages={['lucene']}
        queryMode={queryMode}
        onQueryModeChange={onQueryModeChange}
        onModeChange={onModeChange}
        rightSection={controls}
        toolbarSlot={
          <QueryEditorToolbar
            mode={queryMode === 'sql' ? 'raw' : 'lucene'}
            language={language}
            where={stringValue}
            onWhereChange={next => ingestWhere(next, true)}
            sourceKind={source?.kind}
            fields={identifiers}
            searchFilters={searchFilters}
            chartConfig={chartConfig}
            queryMode={queryMode}
          />
        }
        filtersSlot={
          searchFilters != null && chartConfig != null ? (
            <FilterExpression
              searchFilters={searchFilters}
              chartConfig={chartConfig}
              language={language}
              dateTimeColumns={dateTimeColumns}
            />
          ) : undefined
        }
        onRemoveLastFilter={handleRemoveLastFilter}
        leftSection={
          <Tooltip label="Syntax reference" withArrow position="top">
            <ActionIcon
              variant="subtle"
              size="sm"
              color="gray"
              aria-label="Open syntax reference"
              onClick={openSyntaxRef}
            >
              <IconHelp size={16} />
            </ActionIcon>
          </Tooltip>
        }
        fields={identifiers}
        placeholder={
          language === 'sql'
            ? "SQL WHERE clause (e.g. column = 'foo')"
            : 'Filter this source'
        }
        onSubmit={handleSubmit}
        onBlur={() => ingestWhere(stringValue, true)}
        enableHotkey={enableHotkey}
        data-testid={dataTestId}
      >
        {queryMode === 'sql' ? (
          <ExploreRawSqlEditor
            control={control}
            name={sqlTemplateName as FieldPath<any>}
            tableConnections={_tableConnections ?? []}
            displayType={rawSqlDisplayType}
            dateRange={dateRange}
            timestampValueExpression={source?.timestampValueExpression}
            onSubmit={onSubmit}
          />
        ) : null}
      </QueryEditor>
    </>
  );
}
