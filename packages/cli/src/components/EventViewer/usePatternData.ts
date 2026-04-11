/**
 * Computes log patterns from the currently loaded events using the
 * Drain algorithm (via @hyperdx/common-utils/drain).
 *
 * Mirrors the web frontend's useGroupedPatterns hook but runs
 * synchronously in-process — no Pyodide/WASM needed.
 */
import { useMemo } from 'react';

import {
  TemplateMiner,
  TemplateMinerConfig,
} from '@hyperdx/common-utils/dist/drain';

import type { SourceResponse } from '@/api/client';
import { getEventBody } from '@/shared/source';

import type { EventRow } from './types';
import { flatten } from './utils';

// ---- Types ---------------------------------------------------------

export interface PatternGroup {
  id: string;
  pattern: string;
  count: number;
  samples: EventRow[];
}

// ---- Hook ----------------------------------------------------------

export interface UsePatternDataParams {
  events: EventRow[];
  source: SourceResponse;
}

export interface UsePatternDataReturn {
  patterns: PatternGroup[];
  /** The body column key used for mining */
  bodyColumn: string | undefined;
}

/**
 * Mine patterns from the loaded events.
 *
 * Returns pattern groups sorted by count (descending), each with:
 *   - id: cluster ID from the Drain algorithm
 *   - pattern: the mined template (e.g. "Failed password for <*> from <*>")
 *   - count: number of events matching this pattern
 *   - samples: the raw event rows belonging to this pattern
 */
export function usePatternData({
  events,
  source,
}: UsePatternDataParams): UsePatternDataReturn {
  const bodyColumn = useMemo(() => {
    const expr = getEventBody(source);
    if (expr) return expr;
    // Fallback: use the last column key from the first event
    if (events.length > 0) {
      const keys = Object.keys(events[0]);
      return keys[keys.length - 1];
    }
    return undefined;
  }, [source, events]);

  const patterns = useMemo(() => {
    if (events.length === 0 || !bodyColumn) return [];

    const config = new TemplateMinerConfig();
    const miner = new TemplateMiner(config);

    // Mine patterns from all events
    const clustered: Array<{ clusterId: number; row: EventRow }> = [];
    for (const row of events) {
      const body = row[bodyColumn];
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
        // Match to get the current template for this cluster
        const body = row[bodyColumn];
        const text = body != null ? flatten(String(body)) : '';
        const match = miner.match(text, 'fallback');
        groups.set(clusterId, {
          rows: [row],
          template: match?.getTemplate() ?? text,
        });
      }
    }

    // Convert to sorted array
    const result: PatternGroup[] = [];
    for (const [id, { rows, template }] of groups) {
      result.push({
        id: String(id),
        pattern: template,
        count: rows.length,
        samples: rows,
      });
    }

    result.sort((a, b) => b.count - a.count);
    return result;
  }, [events, bodyColumn]);

  return { patterns, bodyColumn };
}
