/**
 * Fetches a random sample of events from ClickHouse, mines patterns
 * using the Drain algorithm, and estimates total counts using a
 * sampleMultiplier — mirroring the web frontend's useGroupedPatterns.
 */
import { useState, useEffect, useCallback, useRef } from 'react';

import {
  TemplateMiner,
  TemplateMinerConfig,
} from '@hyperdx/common-utils/dist/drain';
import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { convertDateRangeToGranularityString } from '@hyperdx/common-utils/dist/core/utils';

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

// ---- Time bucketing utilities --------------------------------------

/** Parse a granularity string like "5 minute" into seconds. */
function granularityToSeconds(granularity: string): number {
  const [num, unit] = granularity.split(' ');
  const n = parseInt(num, 10);
  switch (unit) {
    case 'second':
      return n;
    case 'minute':
      return n * 60;
    case 'hour':
      return n * 3600;
    case 'day':
      return n * 86400;
    default:
      return n * 60;
  }
}

/** Round a timestamp down to the start of its granularity bucket. */
function toStartOfBucket(ts: number, granularityMs: number): number {
  return Math.floor(ts / granularityMs) * granularityMs;
}

/** Generate all bucket start timestamps between start and end. */
function generateBuckets(
  startMs: number,
  endMs: number,
  granularityMs: number,
): number[] {
  const buckets: number[] = [];
  let current = toStartOfBucket(startMs, granularityMs);
  while (current < endMs) {
    buckets.push(current);
    current += granularityMs;
  }
  return buckets;
}

// ---- Types ---------------------------------------------------------

export interface TrendBucket {
  ts: number;
  count: number;
}

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

      // Compute granularity for trend buckets
      const granularity = convertDateRangeToGranularityString(
        [startTime, endTime],
        24,
      );
      const granularityMs = granularityToSeconds(granularity) * 1000;
      const allBuckets = generateBuckets(
        startTime.getTime(),
        endTime.getTime(),
        granularityMs,
      );

      // Mine patterns
      const config = new TemplateMinerConfig();
      const miner = new TemplateMiner(config);

      const clustered: Array<{
        clusterId: number;
        row: EventRow;
        tsMs: number;
      }> = [];
      for (const row of sampleRows) {
        const body = row[effectiveBodyColumn];
        const text = body != null ? flatten(String(body)) : '';
        const result = miner.addLogMessage(text);
        const tsRaw = row[tsColumn];
        const tsMs =
          tsRaw != null
            ? new Date(String(tsRaw)).getTime()
            : startTime.getTime();
        clustered.push({ clusterId: result.clusterId, row, tsMs });
      }

      // Group by cluster ID
      const groups = new Map<
        number,
        {
          rows: EventRow[];
          template: string;
          bucketCounts: Map<number, number>;
        }
      >();

      for (const { clusterId, row, tsMs } of clustered) {
        const bucket = toStartOfBucket(tsMs, granularityMs);
        const existing = groups.get(clusterId);
        if (existing) {
          existing.rows.push(row);
          existing.bucketCounts.set(
            bucket,
            (existing.bucketCounts.get(bucket) ?? 0) + 1,
          );
        } else {
          const body = row[effectiveBodyColumn];
          const text = body != null ? flatten(String(body)) : '';
          const match = miner.match(text, 'fallback');
          const bucketCounts = new Map<number, number>();
          bucketCounts.set(bucket, 1);
          groups.set(clusterId, {
            rows: [row],
            template: match?.getTemplate() ?? text,
            bucketCounts,
          });
        }
      }

      // Compute sampleMultiplier
      const sampleMultiplier =
        total > 0 && sampleRows.length > 0 ? total / sampleRows.length : 1;

      // Convert to sorted array with estimated counts and trend data
      const result: PatternGroup[] = [];
      for (const [id, { rows, template, bucketCounts }] of groups) {
        const trend: TrendBucket[] = allBuckets.map(bucketTs => ({
          ts: bucketTs,
          count: Math.round(
            (bucketCounts.get(bucketTs) ?? 0) * sampleMultiplier,
          ),
        }));

        result.push({
          id: String(id),
          pattern: template,
          count: rows.length,
          estimatedCount: Math.max(
            Math.round(rows.length * sampleMultiplier),
            1,
          ),
          samples: rows,
          trend,
        });
      }

      result.sort((a, b) => b.estimatedCount - a.estimatedCount);
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
