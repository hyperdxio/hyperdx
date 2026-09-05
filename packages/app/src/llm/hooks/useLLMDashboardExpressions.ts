import { useMemo } from 'react';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

import { useJsonColumns } from '@/hooks/useMetadata';
import { getLLMExpressions, getLLMLogExpressions } from '@/llm/lib/expressions';

/**
 * Derive the LLM dashboard SQL expressions for a trace source, resolving
 * whether the attribute column is JSON-typed (mirrors
 * useServiceDashboardExpressions).
 */
export function useLLMDashboardExpressions({
  source,
}: {
  source: TSource | undefined;
}) {
  const tableConnection = useMemo(() => tcFromSource(source), [source]);

  const { data: jsonColumns, isLoading: isJsonColumnsLoading } =
    useJsonColumns(tableConnection);

  const isLoading = !source || isJsonColumnsLoading;

  const expressions = useMemo(() => {
    if (isLoading || !jsonColumns) return undefined;
    if (source?.kind !== SourceKind.Trace) return undefined;
    return getLLMExpressions(source, jsonColumns);
  }, [source, jsonColumns, isLoading]);

  return { expressions, isLoading };
}

/** Log-source variant: session/detection expressions over LogAttributes. */
export function useLLMLogDashboardExpressions({
  source,
}: {
  source: TSource | undefined;
}) {
  const tableConnection = useMemo(() => tcFromSource(source), [source]);

  const { data: jsonColumns, isLoading: isJsonColumnsLoading } =
    useJsonColumns(tableConnection);

  const isLoading = !source || isJsonColumnsLoading;

  const expressions = useMemo(() => {
    if (isLoading || !jsonColumns) return undefined;
    if (source?.kind !== SourceKind.Log) return undefined;
    return getLLMLogExpressions(source, jsonColumns);
  }, [source, jsonColumns, isLoading]);

  return { expressions, isLoading };
}
