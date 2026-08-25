import { Fragment, memo, useCallback, useMemo } from 'react';
import type { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

import { FilterPill, type PillItem } from '@/components/ActiveFilterPills';
import type { FilterStateHook } from '@/searchFilters';
import { useFormatTime } from '@/useFormatTime';

import {
  type FilterClause,
  type FilterExpr,
  type FilterGroup,
  filterStateToExpression,
  removeFilterClause,
  shouldShowJoins,
} from './filterExpressionModel';
import type { QueryLanguage } from './queryModeSafety';

import styles from './FilterExpression.module.scss';

const EMPTY_DATE_TIME_COLUMNS: ReadonlyMap<string, string> = new Map();

type FormatTime = ReturnType<typeof useFormatTime>;

function clauseToPill(clause: FilterClause): PillItem {
  return {
    field: clause.field,
    value: clause.value,
    type: clause.type,
    rawValue: clause.rawValue,
    displayValue: clause.displayValue,
    range: clause.range,
  };
}

function withDisplayValues(
  expr: FilterExpr,
  dateTimeColumns: ReadonlyMap<string, string>,
  formatTime: FormatTime,
): FilterExpr {
  if (expr.kind === 'clause') {
    if (
      dateTimeColumns.has(expr.field) &&
      typeof expr.rawValue === 'string' &&
      expr.displayValue == null
    ) {
      return {
        ...expr,
        displayValue: formatTime(expr.rawValue, { format: 'withMs' }),
      };
    }
    return expr;
  }
  return {
    ...expr,
    children: expr.children.map(child =>
      withDisplayValues(child, dateTimeColumns, formatTime),
    ),
  };
}

function exprKey(expr: FilterExpr, index: number): string {
  if (expr.kind === 'clause') {
    return `${expr.field}-${expr.type}-${expr.value}-${index}`;
  }
  return `group-${expr.op}-${index}`;
}

function ClauseNode({
  clause,
  language,
  chartConfig,
  onRemove,
  onTogglePolarity,
  onReplaceValue,
}: {
  clause: FilterClause;
  language: QueryLanguage;
  chartConfig: BuilderChartConfigWithDateRange;
  onRemove: (clause: FilterClause) => void;
  onTogglePolarity: (clause: FilterClause) => void;
  onReplaceValue: (clause: FilterClause, value: string) => void;
}) {
  return (
    <FilterPill
      pill={clauseToPill(clause)}
      chartConfig={chartConfig}
      language={language}
      variant="inline"
      onRemove={() => onRemove(clause)}
      onTogglePolarity={() => onTogglePolarity(clause)}
      onReplaceValue={value => onReplaceValue(clause, value)}
    />
  );
}

function GroupNode({
  group,
  language,
  chartConfig,
  onRemove,
  onTogglePolarity,
  onReplaceValue,
}: {
  group: FilterGroup;
  language: QueryLanguage;
  chartConfig: BuilderChartConfigWithDateRange;
  onRemove: (clause: FilterClause) => void;
  onTogglePolarity: (clause: FilterClause) => void;
  onReplaceValue: (clause: FilterClause, value: string) => void;
}) {
  const showJoins = shouldShowJoins(group);
  const chrome = group.op === 'OR';

  return (
    <span
      className={`${styles.group}${chrome ? ` ${styles.groupChrome}` : ''}`}
      data-testid={chrome ? 'filter-or-group' : undefined}
    >
      {chrome && (
        <span className={styles.paren} aria-hidden="true">
          (
        </span>
      )}
      {group.children.map((child, i) => (
        <Fragment key={exprKey(child, i)}>
          {i > 0 && showJoins && (
            <span className={styles.join}>{group.op}</span>
          )}
          {child.kind === 'clause' ? (
            <ClauseNode
              clause={child}
              language={language}
              chartConfig={chartConfig}
              onRemove={onRemove}
              onTogglePolarity={onTogglePolarity}
              onReplaceValue={onReplaceValue}
            />
          ) : (
            <GroupNode
              group={child}
              language={language}
              chartConfig={chartConfig}
              onRemove={onRemove}
              onTogglePolarity={onTogglePolarity}
              onReplaceValue={onReplaceValue}
            />
          )}
        </Fragment>
      ))}
      {chrome && (
        <span className={styles.paren} aria-hidden="true">
          )
        </span>
      )}
    </span>
  );
}

export const FilterExpression = memo(function FilterExpression({
  searchFilters,
  chartConfig,
  language,
  dateTimeColumns = EMPTY_DATE_TIME_COLUMNS,
}: {
  searchFilters: FilterStateHook;
  chartConfig: BuilderChartConfigWithDateRange;
  language: QueryLanguage;
  dateTimeColumns?: ReadonlyMap<string, string>;
}) {
  const { filters, setFilterValue, replaceFilterValue, clearFilter } =
    searchFilters;
  const formatTime = useFormatTime();

  const expr = useMemo(() => {
    const tree = filterStateToExpression(filters);
    if (tree == null) {
      return null;
    }
    return withDisplayValues(tree, dateTimeColumns, formatTime);
  }, [filters, dateTimeColumns, formatTime]);

  const handleRemove = useCallback(
    (clause: FilterClause) => {
      removeFilterClause(clause, { setFilterValue, clearFilter });
    },
    [setFilterValue, clearFilter],
  );

  const handleTogglePolarity = useCallback(
    (clause: FilterClause) => {
      if (clause.rawValue == null) {
        return;
      }
      setFilterValue(
        clause.field,
        clause.rawValue,
        clause.type === 'excluded' ? 'include' : 'exclude',
      );
    },
    [setFilterValue],
  );

  const handleReplaceValue = useCallback(
    (clause: FilterClause, newValue: string) => {
      if (clause.rawValue == null) {
        return;
      }
      replaceFilterValue(
        clause.field,
        clause.rawValue,
        newValue,
        clause.type === 'excluded' ? 'exclude' : 'include',
      );
    },
    [replaceFilterValue],
  );

  if (expr == null) {
    return null;
  }

  return (
    <div className={styles.root} data-testid="filter-expression">
      {expr.kind === 'clause' ? (
        <ClauseNode
          clause={expr}
          language={language}
          chartConfig={chartConfig}
          onRemove={handleRemove}
          onTogglePolarity={handleTogglePolarity}
          onReplaceValue={handleReplaceValue}
        />
      ) : (
        <GroupNode
          group={expr}
          language={language}
          chartConfig={chartConfig}
          onRemove={handleRemove}
          onTogglePolarity={handleTogglePolarity}
          onReplaceValue={handleReplaceValue}
        />
      )}
    </div>
  );
});
