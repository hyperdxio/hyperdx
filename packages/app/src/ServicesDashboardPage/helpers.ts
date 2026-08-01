import SqlString from 'sqlstring';
import type { TSource } from '@hyperdx/common-utils/dist/types';
import {
  Filter,
  isLogSource,
  isTraceSource,
  pickSampleWeightExpressionProps,
} from '@hyperdx/common-utils/dist/types';

import { HARD_LINES_LIMIT } from '@/HDXMultiSeriesTimeChart';
import { getExpressions } from '@/serviceDashboard';

import { AppliedConfig } from './types';

// Extract common chart config fields from a source.
// This avoids union type issues with lodash `pick` on discriminated unions.
export function pickSourceConfigFields(source: TSource) {
  return {
    timestampValueExpression: source.timestampValueExpression,
    connection: source.connection,
    from: source.from,
    ...(isLogSource(source) || isTraceSource(source)
      ? {
          implicitColumnExpression: source.implicitColumnExpression,
          useTextIndexForImplicitColumn: source.useTextIndexForImplicitColumn,
        }
      : {}),
    // Logs-only body fallback for bare-text Lucene search.
    ...(isLogSource(source) ? { bodyExpression: source.bodyExpression } : {}),
    ...pickSampleWeightExpressionProps(source),
  };
}

export const MAX_NUM_SERIES = HARD_LINES_LIMIT;

export function buildInFilterCondition(
  columnExpression: string,
  value: string,
): string {
  return SqlString.format('? IN (?)', [SqlString.raw(columnExpression), value]);
}

export function getScopedFilters({
  appliedConfig,
  expressions,
  includeIsSpanKindServer = true,
  includeNonEmptyEndpointFilter = false,
}: {
  appliedConfig: AppliedConfig;
  expressions: ReturnType<typeof getExpressions>;
  includeIsSpanKindServer?: boolean;
  includeNonEmptyEndpointFilter?: boolean;
}): Filter[] {
  const filters: Filter[] = [...(appliedConfig.additionalFilters || [])];
  // Database spans are of kind Client. To be cleaned up in HDX-1219
  if (includeIsSpanKindServer) {
    filters.push({
      type: 'sql',
      condition: expressions.isSpanKindServer,
    });
  }
  if (appliedConfig.service) {
    filters.push({
      type: 'sql',
      condition: buildInFilterCondition(
        expressions.service,
        appliedConfig.service,
      ),
    });
  }
  if (includeNonEmptyEndpointFilter) {
    filters.push({
      type: 'sql',
      condition: expressions.isEndpointNonEmpty,
    });
  }
  return filters;
}
