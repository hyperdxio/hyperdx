/**
 * Read packages/hdx-eval/ablation/manifest.tsv (written by ablation.sh),
 * grade every batch listed there, and emit a comparison markdown that
 * attributes performance changes to each variant (split / toon / both)
 * relative to the baseline.
 *
 * Usage:
 *   yarn workspace @hyperdx/hdx-eval dev scripts/ablation-report.ts
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import { gradeBatch, resolveBatchDir } from '../src/grading/grade';
import type { BatchSummary } from '../src/reports/aggregate';
import { writeBatchSummary } from '../src/reports/store';

type ManifestRow = {
  variant: string;
  scenario: string;
  batchDir: string;
  startedAt: string;
};

const PKG_ROOT = resolve(__dirname, '..');
const MANIFEST_PATH = resolve(PKG_ROOT, 'ablation', 'manifest.tsv');
const REPORT_PATH = resolve(PKG_ROOT, 'ablation', 'REPORT.md');

const VARIANT_ORDER = ['baseline', 'split', 'toon', 'both'];
const VARIANT_LABEL: Record<string, string> = {
  baseline: 'Baseline',
  split: 'Split',
  toon: 'TOON',
  both: 'Both',
};

function readManifest(): ManifestRow[] {
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  const lines = raw.trim().split('\n');
  const out: ManifestRow[] = [];
  for (const line of lines.slice(1)) {
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    if (!parts[2] || parts[2] === '') continue; // missing batch dir
    out.push({
      variant: parts[0],
      scenario: parts[1],
      batchDir: parts[2],
      startedAt: parts[3],
    });
  }
  return out;
}

async function main() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found: ${MANIFEST_PATH}`);
    process.exit(1);
  }

  const rows = readManifest();
  console.log(`Manifest has ${rows.length} batch entries.`);

  // ── Grade every batch (idempotent — skips runs that already have grade.json) ──
  for (const row of rows) {
    const dir = resolveBatchDir(row.batchDir);
    if (!existsSync(dir)) {
      console.warn(
        `  skip ${row.variant}/${row.scenario}: batch dir missing (${dir})`,
      );
      continue;
    }
    console.log(
      `  grading ${row.variant}/${row.scenario} (${row.batchDir})...`,
    );
    try {
      await gradeBatch(dir, {
        judgeModel: 'claude-opus-4-7',
        rerunJudge: false,
        skipJudge: false,
      });
    } catch (e) {
      console.error(
        `    grade failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ── Render each batch's _summary.{md,json} ──
  for (const row of rows) {
    const dir = resolveBatchDir(row.batchDir);
    if (!existsSync(dir)) continue;
    try {
      writeBatchSummary(dir, resolve(dir, '_summary.md'));
    } catch (e) {
      console.error(`  summary failed for ${row.batchDir}: ${e}`);
    }
  }

  // ── Load per-cell summaries (HDX side only — split/toon/both don't change CH) ──
  type Cell = {
    variant: string;
    scenario: string;
    n: number;
    combined: number;
    programmatic: number;
    judge: number;
    toolCalls: number;
    outputTokens: number;
    wallClockS: number;
    perCheck: Record<string, number>;
  };
  const cells: Cell[] = [];
  for (const row of rows) {
    const dir = resolveBatchDir(row.batchDir);
    const summaryPath = resolve(dir, '_summary.json');
    if (!existsSync(summaryPath)) {
      console.warn(`  no _summary.json in ${row.batchDir}`);
      continue;
    }
    const summary = JSON.parse(
      readFileSync(summaryPath, 'utf8'),
    ) as BatchSummary;
    for (const sc of summary.scenarios) {
      const hdx = sc.cells.hyperdx;
      if (!hdx) continue;
      cells.push({
        variant: row.variant,
        scenario: sc.scenario,
        n: hdx.n,
        combined: hdx.combinedScore.mean,
        programmatic: hdx.programmatic.mean,
        judge: hdx.judge.weightedMean,
        toolCalls: hdx.toolCalls.mean,
        outputTokens: hdx.tokens.output,
        wallClockS: hdx.durationMs.mean / 1000,
        perCheck: hdx.programmatic.perCheck,
      });
    }
  }

  // ── Build report ──
  const scenarios = Array.from(new Set(cells.map(c => c.scenario))).sort();
  const lines: string[] = [];
  lines.push('# Ablation Report — Split Tools / TOON Output');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(
    `Each cell: HDX-only, n=${rows[0]?.batchDir ? 'see below' : '?'}; metric is the HyperDX MCP arm.`,
  );
  lines.push('');

  // Top-line: combined score per (variant, scenario)
  lines.push('## Top-line — Combined Score');
  lines.push('');
  lines.push(
    '| Scenario | ' +
      VARIANT_ORDER.map(v => VARIANT_LABEL[v]).join(' | ') +
      ' | Δ split | Δ toon | Δ both |',
  );
  lines.push(
    '|---|' + VARIANT_ORDER.map(() => '---:').join('|') + '|---:|---:|---:|',
  );
  for (const sc of scenarios) {
    const byVariant: Record<string, Cell> = {};
    for (const c of cells) {
      if (c.scenario === sc) byVariant[c.variant] = c;
    }
    const baseline = byVariant.baseline;
    const cellStr = (c?: Cell) =>
      c ? `${(c.combined * 100).toFixed(0)}% (n=${c.n})` : '—';
    const deltaStr = (c?: Cell) => {
      if (!c || !baseline) return '—';
      const d = (c.combined - baseline.combined) * 100;
      const sign = d >= 0 ? '+' : '';
      return `${sign}${d.toFixed(0)}pp`;
    };
    lines.push(
      '| ' +
        sc +
        ' | ' +
        VARIANT_ORDER.map(v => cellStr(byVariant[v])).join(' | ') +
        ' | ' +
        deltaStr(byVariant.split) +
        ' | ' +
        deltaStr(byVariant.toon) +
        ' | ' +
        deltaStr(byVariant.both) +
        ' |',
    );
  }
  lines.push('');

  // Per-scenario detail tables
  for (const sc of scenarios) {
    lines.push(`## ${sc}`);
    lines.push('');
    lines.push('| Metric | Baseline | Split | TOON | Both |');
    lines.push('|---|---:|---:|---:|---:|');
    const byVariant: Record<string, Cell> = {};
    for (const c of cells) {
      if (c.scenario === sc) byVariant[c.variant] = c;
    }
    const row = (label: string, fn: (c: Cell) => string): string =>
      '| ' +
      label +
      ' | ' +
      VARIANT_ORDER.map(v => {
        const c = byVariant[v];
        return c ? fn(c) : '—';
      }).join(' | ') +
      ' |';
    lines.push(row('Combined score', c => `${(c.combined * 100).toFixed(0)}%`));
    lines.push(
      row('Programmatic score', c => `${(c.programmatic * 100).toFixed(0)}%`),
    );
    lines.push(row('Judge weighted', c => `${(c.judge * 100).toFixed(0)}%`));
    lines.push(row('Tool calls (mean)', c => c.toolCalls.toFixed(1)));
    lines.push(
      row('Output tokens (mean)', c => Math.round(c.outputTokens).toString()),
    );
    lines.push(row('Wall clock s (mean)', c => c.wallClockS.toFixed(1)));
    lines.push(row('N runs', c => String(c.n)));
    lines.push('');
  }

  // Summary commentary
  lines.push('## Attribution');
  lines.push('');
  lines.push(
    'Per-scenario combined-score deltas vs baseline (positive = better):',
  );
  lines.push('');
  for (const sc of scenarios) {
    const byVariant: Record<string, Cell> = {};
    for (const c of cells) {
      if (c.scenario === sc) byVariant[c.variant] = c;
    }
    const b = byVariant.baseline;
    const s = byVariant.split;
    const t = byVariant.toon;
    const both = byVariant.both;
    if (!b) continue;
    const delta = (c?: Cell) =>
      c ? `${((c.combined - b.combined) * 100).toFixed(0)}pp` : '—';
    lines.push(
      `- **${sc}**: split=${delta(s)}, toon=${delta(t)}, both=${delta(both)}`,
    );
  }
  lines.push('');
  lines.push(
    '*N≤2 per cell — single-digit deltas are not significant. Treat any signal of magnitude < 10pp as noise.*',
  );

  const out = lines.join('\n') + '\n';
  writeFileSync(REPORT_PATH, out);
  console.log(`\nWrote ${REPORT_PATH}`);
  console.log('\n--- preview ---\n');
  console.log(out.slice(0, 4000));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
