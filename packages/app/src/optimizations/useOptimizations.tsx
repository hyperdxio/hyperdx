import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';

import { useClickhouseClient } from '@/clickhouse';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import { useSources } from '@/source';

import { useOptimizationDismissals } from './dismissals';
import { optimizationPlugins } from './registry';
import { OptimizationFinding, OptimizationPlugin } from './types';

export type OptimizationResult = {
  plugin: OptimizationPlugin<any>;
  findings: OptimizationFinding<unknown>[];
  activeFindings: OptimizationFinding<unknown>[];
  dismissedFindings: OptimizationFinding<unknown>[];
  isLoading: boolean;
  error?: Error;
};

/**
 * Engine hook for the optimization recommendations system.
 *
 * Each registered plugin runs in its own `useQuery` so a failure or slow
 * detector for one plugin never blocks another. Findings are filtered against
 * the persisted dismissal map to produce `activeFindings`.
 */
export function useOptimizationOpportunities() {
  const { data: sources, isLoading: isLoadingSources } = useSources();
  const clickhouseClient = useClickhouseClient();
  const metadata = useMetadataWithSettings();
  const { isDismissed } = useOptimizationDismissals();

  // A stable fingerprint for sources keeps detection from re-firing on every
  // render while still re-running when the user adds / removes / edits a
  // source (any of which change the input set for plugins).
  const sourcesFingerprint = useMemo(() => {
    if (!sources) return '';
    return sources
      .map(
        s =>
          `${s.id}:${s.kind}:${s.connection}:${s.from.databaseName}.${s.from.tableName}`,
      )
      .sort()
      .join('|');
  }, [sources]);

  const queries = useQueries({
    queries: optimizationPlugins.map(plugin => ({
      queryKey: ['optimization', plugin.id, sourcesFingerprint],
      queryFn: async () => {
        return plugin.detect({
          sources: sources ?? [],
          clickhouseClient,
          metadata,
        });
      },
      enabled: !isLoadingSources && !!sources,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      retry: false,
    })),
  });

  const results = useMemo<OptimizationResult[]>(() => {
    return optimizationPlugins.map((plugin, idx) => {
      const query = queries[idx];
      const findings = query.data ?? [];
      const activeFindings: OptimizationFinding<unknown>[] = [];
      const dismissedFindings: OptimizationFinding<unknown>[] = [];
      for (const finding of findings) {
        if (isDismissed(plugin.id, finding.scopeId)) {
          dismissedFindings.push(finding);
        } else {
          activeFindings.push(finding);
        }
      }
      return {
        plugin,
        findings,
        activeFindings,
        dismissedFindings,
        isLoading: query.isLoading,
        error: query.error ?? undefined,
      };
    });
  }, [queries, isDismissed]);

  const totalActive = useMemo(
    () => results.reduce((sum, r) => sum + r.activeFindings.length, 0),
    [results],
  );

  const totalFindings = useMemo(
    () => results.reduce((sum, r) => sum + r.findings.length, 0),
    [results],
  );

  const isLoading = isLoadingSources || results.some(r => r.isLoading);

  return {
    results,
    totalActive,
    totalFindings,
    isLoading,
  };
}
