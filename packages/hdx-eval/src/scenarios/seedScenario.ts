import type { ClickHouseClient } from '@clickhouse/client';

import { insertLogRows, insertTraceRows } from '../clickhouse/insert';
import {
  ensureScenarioTables,
  truncateScenarioTables,
} from '../clickhouse/schema';
import { mulberry32 } from '../rng/seeded';
import { getScenario } from './index';

export type SeedProgress = {
  tracesInserted: number;
  logsInserted: number;
  batchesCompleted: number;
};

export type SeedResult = {
  tracesInserted: number;
  logsInserted: number;
  tables: { traces: string; logs: string };
};

export async function seedScenario(args: {
  client: ClickHouseClient;
  scenarioName: string;
  seed: number;
  nowMs: number;
  volumeFactor?: number;
  onProgress?: (progress: SeedProgress) => void;
}): Promise<SeedResult> {
  const scenario = getScenario(args.scenarioName);
  const tables = await ensureScenarioTables(args.client, scenario.name);
  await truncateScenarioTables(args.client, scenario.name);
  const rng = mulberry32(args.seed);

  let tracesInserted = 0;
  let logsInserted = 0;
  let batchesCompleted = 0;
  for (const batch of scenario.generate({
    rng,
    nowMs: args.nowMs,
    volumeFactor: args.volumeFactor,
  })) {
    if (batch.traces.length > 0) {
      tracesInserted += await insertTraceRows(
        args.client,
        tables.traces,
        batch.traces,
      );
    }
    if (batch.logs.length > 0) {
      logsInserted += await insertLogRows(args.client, tables.logs, batch.logs);
    }
    batchesCompleted++;
    args.onProgress?.({ tracesInserted, logsInserted, batchesCompleted });
  }
  return { tracesInserted, logsInserted, tables };
}
