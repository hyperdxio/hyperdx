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

import type { SourceResponse, ProxyClickhouseClient } from '@/api/client';
import {
  buildPatternSampleQuery,
  buildTotalCountQuery,
} from '@/api/eventQuery';
import { getEventBody } from '@/shared/source';

import type { EventRow } from './types';
import { flatten } from './utils';

// ---- Constants -----------------------------------------------------

const SAMPLE_LIMIT = 100_000;

// ---- Types ---------------------------------------------------------

export interface PatternGroup {
  id: string;
  pattern: string;
  /** Raw count within the sample */
  count: number;
  /** Estimated total count (count * sampleMultiplier), prefixed with ~ in display */
  estimatedCount: number;
  samples: EventRow[];
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
            sampleLimit: SAMPLE_LIMIT,
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

      // Determine the body column from the result keys
      const effectiveBodyColumn =
        bodyColumn ??
        (() => {
          const keys = Object.keys(sampleRows[0]);
          return keys[0]; // first column is the body from our SELECT
        })();

      // Mine patterns
      const config = new TemplateMinerConfig();
      const miner = new TemplateMiner(config);

      const clustered: Array<{ clusterId: number; row: EventRow }> = [];
      for (const row of sampleRows) {
        const body = row[effectiveBodyColumn];
        const text = body != null ? flatten(String(body)) : '';
        const result = miner.addLogMessage(text);
        clustered.push({ clusterId: result.clusterId, row });
      }

      // Group by cluster ID
      const groups = new Map<number, { rows: EventRow[]; template: string }>();

      for (const { clusterId, row } of clustered) {
        const existing = groups.get(clusterId);
        if (existing) {
          existing.rows.push(row);
        } else {
          const body = row[effectiveBodyColumn];
          const text = body != null ? flatten(String(body)) : '';
          const match = miner.match(text, 'fallback');
          groups.set(clusterId, {
            rows: [row],
            template: match?.getTemplate() ?? text,
          });
        }
      }

      // Compute sampleMultiplier
      const sampleMultiplier =
        total > 0 && sampleRows.length > 0 ? total / sampleRows.length : 1;

      // Convert to sorted array with estimated counts
      const result: PatternGroup[] = [];
      for (const [id, { rows, template }] of groups) {
        result.push({
          id: String(id),
          pattern: template,
          count: rows.length,
          estimatedCount: Math.max(
            Math.round(rows.length * sampleMultiplier),
            1,
          ),
          samples: rows,
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
