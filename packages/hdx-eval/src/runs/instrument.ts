import type { ClickHouseClient } from '@clickhouse/client';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { createEvalClient, defaultClickHouseUrl } from '@/clickhouse/client';
import { scenarioTables } from '@/clickhouse/schema';
import type { RunRecord } from '@/harness/types';
import { SCENARIO_NAMES } from '@/scenarios';

import { getRunFilesInBatch, runsRoot } from './path';

const QUERY_LOG_BUFFER_MS = 5_000;

type ServerQuery = {
  eventTime: string;
  queryDurationMs: number;
  readRows: number;
  resultRows: number;
  memoryUsageBytes: number;
  queryPreview: string;
};

type ToolCallTiming = {
  index: number;
  name: string;
  wallStartTs: string;
  wallEndTs: string;
  wallMs: number;
  serverQueries: ServerQuery[];
  serverMs: number;
  inferenceMs: number;
};

export type TimingRecord = {
  schemaVersion: 1;
  runId: string;
  scenario: string;
  mcp: string;
  toolCalls: ToolCallTiming[];
  totalWallMs: number;
  totalServerMs: number;
  totalInferenceMs: number;
  unmatchedQueriesCount: number;
};

type QueryLogRow = {
  event_time_microseconds: string;
  query_duration_ms: number | string;
  read_rows: number | string;
  result_rows: number | string;
  memory_usage: number | string;
  query: string;
};

export type InstrumentOptions = {
  clickhouseUrl?: string;
  username?: string;
  password?: string;
};

/**
 * Walk each run's `messages` array to derive per-tool-call wall-clock
 * windows from user-message timestamps (which are present) plus
 * tool_use ids in the preceding assistant message.
 */
function extractToolCallWindows(record: RunRecord): Array<{
  index: number;
  name: string;
  startTs: string;
  endTs: string;
}> {
  const out: Array<{
    index: number;
    name: string;
    startTs: string;
    endTs: string;
  }> = [];
  let prevTs: string | null = record.startedAt;
  let lastToolUseName: string | null = null;
  let idx = 0;
  for (const ev of record.messages as Array<Record<string, unknown>>) {
    const t = ev?.type;
    if (t === 'system' && ev.subtype === 'init') {
      const stamp = ev.timestamp;
      if (typeof stamp === 'string') prevTs = stamp;
    } else if (t === 'assistant') {
      const msg = (ev.message as Record<string, unknown>) ?? {};
      const content = Array.isArray(msg.content)
        ? (msg.content as unknown[])
        : [];
      for (const block of content) {
        if (
          block &&
          typeof block === 'object' &&
          (block as Record<string, unknown>).type === 'tool_use'
        ) {
          const name = (block as Record<string, unknown>).name;
          if (typeof name === 'string') lastToolUseName = name;
        }
      }
    } else if (t === 'user') {
      const ts = ev.timestamp;
      if (typeof ts !== 'string') continue;
      const msg = (ev.message as Record<string, unknown>) ?? {};
      const content = Array.isArray(msg.content)
        ? (msg.content as unknown[])
        : [];
      const hasToolResult = content.some(
        b =>
          b &&
          typeof b === 'object' &&
          (b as Record<string, unknown>).type === 'tool_result',
      );
      if (!hasToolResult) continue;
      out.push({
        index: idx++,
        name: lastToolUseName ?? 'unknown',
        startTs: prevTs ?? record.startedAt,
        endTs: ts,
      });
      prevTs = ts;
    }
  }
  return out;
}

async function fetchQueryLog(
  client: ClickHouseClient,
  startTs: string,
  endTs: string,
  tablePatterns: string[],
): Promise<QueryLogRow[]> {
  const startMs = Date.parse(startTs) - QUERY_LOG_BUFFER_MS;
  const endMs = Date.parse(endTs) + QUERY_LOG_BUFFER_MS;
  const startStr = new Date(startMs)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
  const endStr = new Date(endMs).toISOString().slice(0, 19).replace('T', ' ');
  // Match queries that touch any of the given table patterns.
  const orClauses = tablePatterns
    .map(
      p =>
        `query LIKE '%${p.replace(/'/g, "''").replace(/_/g, '\\_').replace(/%/g, '\\%')}%' ESCAPE '\\'`,
    )
    .join(' OR ');
  // Restrict to SELECT-shaped queries — agents don't issue INSERTs, but the
  // re-seed step right before the run does, and we don't want those in the
  // per-call attribution.
  const sql = `
    SELECT
      toString(event_time_microseconds) AS event_time_microseconds,
      query_duration_ms,
      read_rows,
      result_rows,
      memory_usage,
      substring(query, 1, 240) AS query
    FROM system.query_log
    WHERE type = 'QueryFinish'
      AND event_time >= toDateTime('${startStr}')
      AND event_time <= toDateTime('${endStr}')
      AND query_kind = 'Select'
      AND (${orClauses})
    ORDER BY event_time_microseconds
    SETTINGS max_execution_time = 30
  `;
  const rs = await client.query({ query: sql, format: 'JSONEachRow' });
  return (await rs.json<QueryLogRow>()) as QueryLogRow[];
}

function matchQueriesToCalls(
  windows: ReturnType<typeof extractToolCallWindows>,
  queries: QueryLogRow[],
): { calls: ToolCallTiming[]; unmatched: number } {
  const callTimings: ToolCallTiming[] = windows.map(w => ({
    index: w.index,
    name: w.name,
    wallStartTs: w.startTs,
    wallEndTs: w.endTs,
    wallMs: Math.max(0, Date.parse(w.endTs) - Date.parse(w.startTs)),
    serverQueries: [],
    serverMs: 0,
    inferenceMs: 0,
  }));

  let unmatched = 0;
  for (const q of queries) {
    // ClickHouse returns toString(DateTime64(6)) as 'YYYY-MM-DD HH:MM:SS.uuuuuu'
    // (UTC, space-separated). Convert to ISO so Date.parse() accepts it.
    const isoForm = q.event_time_microseconds.replace(' ', 'T') + 'Z';
    const ts = Date.parse(isoForm);
    if (!Number.isFinite(ts)) {
      unmatched++;
      continue;
    }
    // Walk calls in reverse: prefer the LATEST call whose start <= ts. This
    // assigns queries to the call that issued them even when there's a small
    // network/processing lag between query event_time and the user-message
    // timestamp that closes the window.
    let owner: ToolCallTiming | undefined;
    for (let i = callTimings.length - 1; i >= 0; i--) {
      const c = callTimings[i];
      const start = Date.parse(c.wallStartTs);
      const end = Date.parse(c.wallEndTs);
      if (ts >= start && ts <= end + QUERY_LOG_BUFFER_MS) {
        owner = c;
        break;
      }
    }
    if (!owner) {
      unmatched++;
      continue;
    }
    const durMs = Number(q.query_duration_ms);
    owner.serverQueries.push({
      eventTime: q.event_time_microseconds,
      queryDurationMs: Number.isFinite(durMs) ? durMs : 0,
      readRows: Number(q.read_rows),
      resultRows: Number(q.result_rows),
      memoryUsageBytes: Number(q.memory_usage),
      queryPreview: q.query,
    });
    owner.serverMs += Number.isFinite(durMs) ? durMs : 0;
  }

  for (const c of callTimings) {
    c.inferenceMs = Math.max(0, c.wallMs - c.serverMs);
  }
  return { calls: callTimings, unmatched };
}

async function instrumentRun(args: {
  runPath: string;
  client: ClickHouseClient;
}): Promise<TimingRecord> {
  const record = JSON.parse(readFileSync(args.runPath, 'utf8')) as RunRecord;
  const windows = extractToolCallWindows(record);

  // Match query_log on either the eval-specific tables OR system.tables
  // calls (mcp-clickhouse does list_tables internally).
  const tables = scenarioTables(record.scenario);
  const tablePatterns = [tables.traces, tables.logs, 'system.tables'];

  const queries = await fetchQueryLog(
    args.client,
    record.startedAt,
    record.endedAt,
    tablePatterns,
  );
  const matched = matchQueriesToCalls(windows, queries);

  const totalWall = matched.calls.reduce((s, c) => s + c.wallMs, 0);
  const totalServer = matched.calls.reduce((s, c) => s + c.serverMs, 0);

  const timing: TimingRecord = {
    schemaVersion: 1,
    runId: record.runId,
    scenario: record.scenario,
    mcp: record.mcp,
    toolCalls: matched.calls,
    totalWallMs: totalWall,
    totalServerMs: totalServer,
    totalInferenceMs: Math.max(0, totalWall - totalServer),
    unmatchedQueriesCount: matched.unmatched,
  };
  const sidecarPath = args.runPath.replace(/\.json$/, '.timing.json');
  writeFileSync(sidecarPath, JSON.stringify(timing, null, 2) + '\n', 'utf8');
  return timing;
}

export async function instrumentBatch(
  batchDir: string,
  opts: InstrumentOptions = {},
): Promise<TimingRecord[]> {
  const resolved = existsSync(batchDir) ? batchDir : join(runsRoot(), batchDir);
  if (!existsSync(resolved)) {
    throw new Error(`Batch not found: ${resolved}`);
  }
  const client = createEvalClient({
    url: opts.clickhouseUrl ?? defaultClickHouseUrl(),
    username: opts.username,
    password: opts.password,
  });
  try {
    const out: TimingRecord[] = [];
    const runPaths = getRunFilesInBatch(resolved, {
      scenarioFilter: s => SCENARIO_NAMES.includes(s),
    });
    for (const runPath of runPaths) {
      const timing = await instrumentRun({ runPath, client });
      out.push(timing);
    }
    return out;
  } finally {
    await client.close();
  }
}

export function summarizeTimingRecord(t: TimingRecord): string {
  const wall = (t.totalWallMs / 1000).toFixed(1);
  const server = (t.totalServerMs / 1000).toFixed(2);
  const inference = (t.totalInferenceMs / 1000).toFixed(1);
  const serverPct =
    t.totalWallMs > 0 ? Math.round((t.totalServerMs / t.totalWallMs) * 100) : 0;
  return (
    `${t.scenario}/${t.mcp}: wall=${wall}s  server=${server}s (${serverPct}%)  ` +
    `inference=${inference}s  calls=${t.toolCalls.length}  unmatched=${t.unmatchedQueriesCount}`
  );
}
