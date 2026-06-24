import type { LogRow, TraceRow } from '@/generators/types';
import type { SeededRng } from '@/rng/seeded';

export type GenerateContext = {
  rng: SeededRng;
  nowMs: number;
  /**
   * Test-only override. Scenarios should multiply background counts by this
   * factor. Planted anomaly counts (the diagnostic signal) stay fixed so
   * structural invariants still hold at low volume. Default 1.
   */
  volumeFactor?: number;
  /**
   * Rows per batch for streaming generation. Default 10_000. Tests can pass
   * a larger value to reduce overhead when collecting.
   */
  batchSize?: number;
};

export type ScenarioBatch = {
  traces: TraceRow[];
  logs: LogRow[];
};

export type Scenario = {
  name: string;
  agentPrompt: string;
  description: string;
  /**
   * Yields batches of rows for insertion. Implementations should respect
   * `ctx.batchSize` (cap per-yield row count) and `ctx.volumeFactor`
   * (scale background volumes — planted anomalies stay constant).
   */
  generate(ctx: GenerateContext): Iterable<ScenarioBatch>;
  groundTruth: Record<string, unknown>;
};

/** Helper for tests: drain an iterable into one combined batch. */
export function collectScenario(iter: Iterable<ScenarioBatch>): ScenarioBatch {
  const traces: TraceRow[] = [];
  const logs: LogRow[] = [];
  for (const b of iter) {
    if (b.traces.length) traces.push(...b.traces);
    if (b.logs.length) logs.push(...b.logs);
  }
  return { traces, logs };
}
