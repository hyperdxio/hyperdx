import {
  buildSeverityClassExpressionV1,
  SEVERITY_CLASS_ERROR_VALUES,
} from '@hyperdx/common-utils/dist/core/severity';
import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';
import { filtersToQuery } from '@hyperdx/common-utils/dist/filters';
import { Filter, isLogSource, TSource } from '@hyperdx/common-utils/dist/types';

import {
  getKnownColumnsList,
  getSelectableSeverityNumberExpression,
} from '@/hooks/useMaterializedAliasColumnsOption';

// Backticks don't survive the URL filter round trip (cleanClickHouseExpression
// strips them), and the saved-search API rejects keys with a bare AND/OR/NOT.
function isUsableInFilterKey(expression: string): boolean {
  return !expression.includes('`') && !/\b(AND|OR|NOT)\b/i.test(expression);
}

/**
 * The Severity facet's filter key for a log source, or undefined when the
 * source has no usable Severity Number Expression. It reads only the saved
 * source config, so it doesn't change while column metadata loads.
 */
export function getSeverityClassKey(source?: TSource): string | undefined {
  if (source == null || !isLogSource(source)) return undefined;

  const numberExpr = getSelectableSeverityNumberExpression(source);
  if (numberExpr == null) return undefined;

  const textExpr = source.severityTextExpression?.trim();
  const knownColumns = getKnownColumnsList(source);
  // The key reads the text too, which a Distributed or Merge source restricted
  // to its Known Columns List may not be able to select.
  if (
    textExpr &&
    knownColumns != null &&
    !splitAndTrimWithBracket(knownColumns).includes(textExpr)
  ) {
    return undefined;
  }

  if (![numberExpr, textExpr ?? ''].every(isUsableInFilterKey)) {
    return undefined;
  }

  return buildSeverityClassExpressionV1({ numberExpr, textExpr });
}

/** A SQL condition matching FATAL and ERROR rows, in the facet's format. */
export function getSeverityClassErrorCondition(
  source?: TSource,
): string | undefined {
  const key = getSeverityClassKey(source);
  if (key == null) return undefined;

  return filtersToQuery({
    [key]: {
      included: new Set(SEVERITY_CLASS_ERROR_VALUES),
      excluded: new Set(),
    },
  })[0].condition;
}

/**
 * The where and filters for a K8s panel's logs table. Spread both into the
 * config: on sources without the field, 'error' falls back to the Lucene term.
 */
export function getLogsResultTypeQuery({
  source,
  where,
  resultType,
}: {
  source?: TSource;
  where: string;
  resultType: 'all' | 'error';
}): { where: string; filters?: Filter[] } {
  if (resultType !== 'error') return { where };
  const condition = getSeverityClassErrorCondition(source);
  return condition == null
    ? { where: `${where} Severity:err` }
    : { where, filters: [{ type: 'sql', condition }] };
}
