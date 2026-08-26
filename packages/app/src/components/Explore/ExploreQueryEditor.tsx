import { useCallback, useMemo } from 'react';
import { FieldPath, useController, UseControllerProps } from 'react-hook-form';
import { JSDataType } from '@hyperdx/common-utils/dist/clickhouse';
import {
  type Field,
  TableConnectionChoice,
} from '@hyperdx/common-utils/dist/core/metadata';
import {
  BuilderChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';
import { useDisclosure } from '@mantine/hooks';

import SyntaxReferenceModal from '@/components/SearchInput/SyntaxReferenceModal';
import { useMultipleAllFields } from '@/hooks/useMetadata';
import type { FilterStateHook } from '@/searchFilters';
import { useSource } from '@/source';

import { AddFilterControl } from './AddFilterControl';
import { ExploreLanguageAddon } from './ExploreLanguageAddon';
import { ExploreSqlPanel } from './ExploreSqlPanel';
import { ExploreSqlToggle } from './ExploreSqlToggle';
import { FilterExpression } from './FilterExpression';
import {
  filterStateToExpression,
  lastClause,
  removeFilterClause,
} from './filterExpressionModel';
import { promoteWhereToFilters } from './promoteWhereToFilters';
import { QueryConfigMode, QueryEditor, QueryLanguage } from './QueryEditor';
import { getDefaultExploreLanguage } from './queryModeSafety';

/** Map column syntax matches the autocomplete: `LogAttributes['level']`. */
const fieldIdentifier = (field: Field): string =>
  field.path.length > 1
    ? `${field.path[0]}['${field.path[1]}']`
    : field.path[0];

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
   * Whether the SQL editor is disclosed. When `onSqlOpenChange` is provided a
   * `SQL` toggle appears in the header; the search input stays visible either
   * way.
   */
  sqlOpen?: boolean;
  onSqlOpenChange?: (open: boolean) => void;
  /**
   * `'builder'` means the SQL is generated from the search above and kept in
   * step with it; `'sql'` means the user has taken it over.
   */
  queryMode?: QueryConfigMode;
  /**
   * Called when the user edits the SQL, to hand the query over to them.
   * Receives the new text so the caller can ignore echoes of its own writes.
   */
  onSqlEdit?: (value: string) => void;
  /** Called to hand the query back to the generator. */
  onSqlReset?: () => void;
  /** Form field name for the raw-SQL template. */
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
  sqlOpen = false,
  onSqlOpenChange,
  queryMode,
  onSqlEdit,
  onSqlReset,
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
    languageField.value ?? getDefaultExploreLanguage();

  const stringValue =
    typeof valueField.value === 'string' ? valueField.value : '';
  const sqlTemplateValue =
    typeof sqlTemplateField.value === 'string' ? sqlTemplateField.value : '';

  const sqlEdited = queryMode === 'sql';

  const identifiers = useMemo(() => {
    return [
      ...(fields?.map(fieldIdentifier) ?? []),
      ...(additionalSuggestions ?? []),
    ];
  }, [fields, additionalSuggestions]);

  // Which fields a bound can be compared against. Only these get `>` and
  // friends in the Add filter popover, since a range compiles to an unquoted
  // literal and would be invalid SQL against a string column.
  const numericFields = useMemo(
    () =>
      new Set(
        fields
          ?.filter(c => c.jsType === JSDataType.Number)
          .map(fieldIdentifier) ?? [],
      ),
    [fields],
  );

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
        rightSection={controls}
        addonSlot={
          <ExploreLanguageAddon
            language={language}
            onOpenSyntaxReference={openSyntaxRef}
          />
        }
        sqlToggle={
          onSqlOpenChange != null ? (
            <ExploreSqlToggle
              open={sqlOpen}
              edited={sqlEdited}
              onToggle={() => onSqlOpenChange(!sqlOpen)}
            />
          ) : undefined
        }
        sqlPanel={
          sqlOpen ? (
            <ExploreSqlPanel
              control={control}
              name={sqlTemplateName as FieldPath<any>}
              tableConnections={_tableConnections ?? []}
              displayType={rawSqlDisplayType}
              dateRange={dateRange}
              timestampValueExpression={source?.timestampValueExpression}
              onSubmit={onSubmit}
              sqlTemplate={sqlTemplateValue}
              edited={sqlEdited}
              onEdit={onSqlEdit}
              onReset={() => onSqlReset?.()}
            />
          ) : undefined
        }
        addFilterSlot={
          searchFilters != null ? (
            <AddFilterControl
              fields={identifiers}
              numericFields={numericFields}
              searchFilters={searchFilters}
              chartConfig={chartConfig}
            />
          ) : undefined
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
        fields={identifiers}
        placeholder={
          language === 'sql'
            ? // The addon already says WHERE, so the placeholder spends its
              // width on an example instead of repeating the label.
              "ServiceName = 'checkout' AND SeverityText = 'error'"
            : 'Search this source, e.g. service:checkout'
        }
        onSubmit={handleSubmit}
        onBlur={() => ingestWhere(stringValue, true)}
        enableHotkey={enableHotkey}
        data-testid={dataTestId}
      />
    </>
  );
}
