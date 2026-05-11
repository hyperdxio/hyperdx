/**
 * Fetches a random sample of events from ClickHouse, mines patterns
 * using the Drain algorithm, and estimates total counts using a
 * sampleMultiplier — mirroring the web frontend's useGroupedPatterns.
 */
import { useState, useEffect, useCallback, useRef } from 'react';

import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import {
  minePatterns,
  type TrendBucket,
} from '@hyperdx/common-utils/dist/drain';

import type { SourceResponse, ProxyClickhouseClient } from '@/api/client';
import {
  buildPatternSampleQuery,
  buildTotalCountQuery,
} from '@/api/eventQuery';
import { getEventBody } from '@/shared/source';

import type { EventRow } from './types';
import { flatten } from './utils';

// ---- Constants -----------------------------------------------------

const SAMPLES = 10_000;

// ---- Types ---------------------------------------------------------

export type { TrendBucket };

/** CLI-specific pattern group that preserves full EventRow samples and uses `count` for backward compat. */
export interface PatternGroup {
  id: string;
  pattern: string;
  /** Raw count within the sample */
  count: number;
  /** Estimated total count (count * sampleMultiplier), prefixed with ~ in display */
  estimatedCount: number;
  samples: EventRow[];
  /** Time-bucketed trend data for sparkline */
  trend: TrendBucket[];
}

export interface UsePatternDataParams {
  clickhouseClient: ProxyClickhouseClient;
  metadata: Metadata;
  source: SourceResponse;
  submittedQuery: string;
  startTime: Date;
  endTime: Date;
  /** Only fetch when true (i.e., pattern view is open) */
  enabled: boolean;
}

export interface UsePatternDataReturn {
  patterns: PatternGroup[];
  loading: boolean;
  error: Error | null;
  totalCount: number | null;
  sampledRowCount: number;
}

// ---- Hook ----------------------------------------------------------

export function usePatternData({
  clickhouseClient,
  metadata,
  source,
  submittedQuery,
  startTime,
  endTime,
  enabled,
}: UsePatternDataParams): UsePatternDataReturn {
  const [patterns, setPatterns] = useState<PatternGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [sampledRowCount, setSampledRowCount] = useState(0);

  // Track the last query params to avoid redundant fetches
  const lastFetchRef = useRef<string>('');

  const bodyColumn = (() => {
    const expr = getEventBody(source);
    if (expr) return expr;
    return undefined;
  })();

  const fetchPatterns = useCallback(async () => {
    const fetchKey = JSON.stringify({
      source: source.id,
      submittedQuery,
      startTime: startTime.getTime(),
      endTime: endTime.getTime(),
    });

    // Skip if we already fetched for these exact params
    if (lastFetchRef.current === fetchKey) return;
    lastFetchRef.current = fetchKey;

    setLoading(true);
    setError(null);

    try {
      // Fire both queries in parallel
      const [sampleChSql, countChSql] = await Promise.all([
        buildPatternSampleQuery(
          {
            source,
            searchQuery: submittedQuery,
            startTime,
            endTime,
            sampleLimit: SAMPLES,
          },
          metadata,
        ),
        buildTotalCountQuery(
          { source, searchQuery: submittedQuery, startTime, endTime },
          metadata,
        ),
      ]);

      const [sampleResult, countResult] = await Promise.all([
        clickhouseClient.query({
          query: sampleChSql.sql,
          query_params: sampleChSql.params,
          format: 'JSON',
          connectionId: source.connection,
        }),
        clickhouseClient.query({
          query: countChSql.sql,
          query_params: countChSql.params,
          format: 'JSON',
          connectionId: source.connection,
        }),
      ]);

      const sampleJson = (await sampleResult.json()) as { data: EventRow[] };
      const countJson = (await countResult.json()) as {
        data: Array<Record<string, string | number>>;
      };

      const sampleRows = sampleJson.data ?? [];
      const total = Number(countJson.data?.[0]?.total ?? 0);

      setTotalCount(total);
      setSampledRowCount(sampleRows.length);

      if (sampleRows.length === 0) {
        setPatterns([]);
        setLoading(false);
        return;
      }

      // Determine columns from the result keys
      const resultKeys = Object.keys(sampleRows[0]);
      const effectiveBodyColumn =
        bodyColumn ?? resultKeys[resultKeys.length - 1];
      // Use the source's timestamp expression, falling back to the first column
      const tsExpr = source.timestampValueExpression ?? 'TimestampTime';
      const tsColumn = resultKeys.find(k => k === tsExpr) ?? resultKeys[0];

      // Mine patterns using the shared Drain pipeline
      const { patterns: rawPatterns } = minePatterns(sampleRows, {
        totalCount: total,
        startDate: startTime,
        endDate: endTime,
        trendBuckets: 24,
        maxSamples: sampleRows.length,
        getBody: row => {
          const body = row[effectiveBodyColumn];
          return body != null ? flatten(String(body)) : '';
        },
        getTimestamp: row => {
          const tsRaw = row[tsColumn];
          return tsRaw != null ? new Date(String(tsRaw)).getTime() : null;
        },
      });

      // Convert to CLI pattern shape (preserves full EventRow samples)
      const result: PatternGroup[] = rawPatterns.map(p => ({
        id: p.id,
        pattern: p.pattern,
        count: p.sampleCount,
        estimatedCount: p.estimatedCount,
        samples: p.samples,
        trend: p.trend,
      }));

      setPatterns(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err : new Error(String(err)));
      // Clear the fetch key so a retry will re-fetch
      lastFetchRef.current = '';
    } finally {
      setLoading(false);
    }
  }, [
    clickhouseClient,
    metadata,
    source,
    submittedQuery,
    startTime,
    endTime,
    bodyColumn,
  ]);

  useEffect(() => {
    if (enabled) {
      fetchPatterns();
    }
  }, [enabled, fetchPatterns]);

  // Clear patterns when disabled
  useEffect(() => {
    if (!enabled) {
      lastFetchRef.current = '';
    }
  }, [enabled]);

  return { patterns, loading, error, totalCount, sampledRowCount };
}
