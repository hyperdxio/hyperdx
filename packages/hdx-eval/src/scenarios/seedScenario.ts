import type { ClickHouseClient } from '@clickhouse/client';

import {
  insertExponentialHistogramMetricRows,
  insertGaugeMetricRows,
  insertHistogramMetricRows,
  insertLogRows,
  insertSummaryMetricRows,
  insertSumMetricRows,
  insertTraceRows,
} from '@/clickhouse/insert';
import {
  ensureScenarioTables,
  type ScenarioTables,
  truncateScenarioTables,
} from '@/clickhouse/schema';
import { mulberry32 } from '@/rng/seeded';

import { getScenario } from './index';
import type { MetricBatch } from './types';

export type MetricInsertCounts = {
  gauge: number;
  sum: number;
  histogram: number;
  exponentialHistogram: number;
  summary: number;
};

const ZERO_METRIC_COUNTS: MetricInsertCounts = {
  gauge: 0,
  sum: 0,
  histogram: 0,
  exponentialHistogram: 0,
  summary: 0,
};

export function getTotalMetrics(counts: MetricInsertCounts): number {
  return (
    counts.gauge +
    counts.sum +
    counts.histogram +
    counts.exponentialHistogram +
    counts.summary
  );
}

export type SeedProgress = {
  tracesInserted: number;
  logsInserted: number;
  metricsInserted: MetricInsertCounts;
  batchesCompleted: number;
};

export type SeedResult = {
  tracesInserted: number;
  logsInserted: number;
  metricsInserted: MetricInsertCounts;
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
  const metricsInserted: MetricInsertCounts = { ...ZERO_METRIC_COUNTS };
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
    if (batch.metrics) {
      await insertMetricBatch(
        args.client,
        tables,
        batch.metrics,
        metricsInserted,
      );
    }

    batchesCompleted++;
    args.onProgress?.({
      tracesInserted,
      logsInserted,
      metricsInserted,
      batchesCompleted,
    });
  }
  return { tracesInserted, logsInserted, metricsInserted, tables };
}

async function insertMetricBatch(
  client: ClickHouseClient,
  tables: ScenarioTables,
  metrics: MetricBatch,
  counts: MetricInsertCounts,
): Promise<void> {
  if (metrics.gauge?.length) {
    counts.gauge += await insertGaugeMetricRows(
      client,
      tables.metricsGauge,
      metrics.gauge,
    );
  }
  if (metrics.sum?.length) {
    counts.sum += await insertSumMetricRows(
      client,
      tables.metricsSum,
      metrics.sum,
    );
  }
  if (metrics.histogram?.length) {
    counts.histogram += await insertHistogramMetricRows(
      client,
      tables.metricsHistogram,
      metrics.histogram,
    );
  }
  if (metrics.exponentialHistogram?.length) {
    counts.exponentialHistogram += await insertExponentialHistogramMetricRows(
      client,
      tables.metricsExponentialHistogram,
      metrics.exponentialHistogram,
    );
  }
  if (metrics.summary?.length) {
    counts.summary += await insertSummaryMetricRows(
      client,
      tables.metricsSummary,
      metrics.summary,
    );
  }
}
