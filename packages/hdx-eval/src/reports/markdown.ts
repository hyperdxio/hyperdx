import type { BatchSummary, ScenarioSummary } from './aggregate';

export function renderMarkdownReport(summary: BatchSummary): string {
  const lines: string[] = [];
  lines.push(`# Eval Batch — ${basename(summary.batchDir)}`);
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push('');
  lines.push(renderTopVerdict(summary));
  lines.push('');

  for (const scenario of summary.scenarios) {
    lines.push(`## ${scenario.scenario}`);
    lines.push('');
    lines.push(renderScenarioTable(scenario));
    lines.push('');
    const judgeBreakdown = renderJudgeBreakdown(scenario);
    if (judgeBreakdown) {
      lines.push(judgeBreakdown);
      lines.push('');
    }
    const programmaticBreakdown = renderProgrammaticBreakdown(scenario);
    if (programmaticBreakdown) {
      lines.push(programmaticBreakdown);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function renderTopVerdict(summary: BatchSummary): string {
  const rows = [
    '| Scenario | HyperDX | ClickHouse | Δ (combined) |',
    '|---|---|---|---|',
  ];
  for (const s of summary.scenarios) {
    const h = s.cells.hyperdx;
    const c = s.cells.clickhouse;
    const hCell = h ? pct(h.combinedScore.mean) : '—';
    const cCell = c ? pct(c.combinedScore.mean) : '—';
    const delta =
      s.delta.combinedScore === null ? '—' : signedPct(s.delta.combinedScore);
    rows.push(`| ${s.scenario} | ${hCell} | ${cCell} | ${delta} |`);
  }
  return ['### Top-line verdict', '', ...rows].join('\n');
}

function renderScenarioTable(scenario: ScenarioSummary): string {
  const h = scenario.cells.hyperdx;
  const c = scenario.cells.clickhouse;
  const rows = [
    '| Metric | HyperDX | ClickHouse | Δ (HDX − CH) |',
    '|---|---|---|---|',
  ];
  rows.push(
    row(
      'Combined score',
      val(h?.combinedScore.mean, pct),
      val(c?.combinedScore.mean, pct),
      signedPct(scenario.delta.combinedScore),
    ),
  );
  rows.push(
    row(
      'Programmatic score',
      val(h?.programmatic.mean, pct),
      val(c?.programmatic.mean, pct),
      signedPct(scenario.delta.programmaticScore),
    ),
  );
  rows.push(
    row(
      'Judge mean (weighted)',
      val(h?.judge.weightedMean, pct),
      val(c?.judge.weightedMean, pct),
      signedPct(scenario.delta.judgeWeightedMean),
    ),
  );
  rows.push(
    row(
      'Tool calls (mean)',
      val(h?.toolCalls.mean, oneDecimal),
      val(c?.toolCalls.mean, oneDecimal),
      signedNumber(scenario.delta.toolCalls, 1),
    ),
  );
  rows.push(
    row(
      'Tool errors (mean)',
      val(h?.toolErrors?.mean, oneDecimal),
      val(c?.toolErrors?.mean, oneDecimal),
      h && c
        ? signedNumber((h.toolErrors?.mean ?? 0) - (c.toolErrors?.mean ?? 0), 1)
        : '—',
    ),
  );
  rows.push(
    row(
      'Tool-error penalty',
      val(h?.toolErrors?.penaltyMean, x => `${(x * 100).toFixed(0)}pp`),
      val(c?.toolErrors?.penaltyMean, x => `${(x * 100).toFixed(0)}pp`),
      '—',
    ),
  );
  rows.push(
    row(
      'Output tokens (mean)',
      val(h?.tokens.output, intStr),
      val(c?.tokens.output, intStr),
      signedNumber(scenario.delta.outputTokens, 0),
    ),
  );
  rows.push(
    row(
      'Cache reads (mean)',
      val(h?.tokens.cacheRead, intStr),
      val(c?.tokens.cacheRead, intStr),
      h && c ? signedNumber(h.tokens.cacheRead - c.tokens.cacheRead, 0) : '—',
    ),
  );
  rows.push(
    row(
      'Wall clock (s, mean)',
      val(h?.durationMs.mean, secondsFromMs),
      val(c?.durationMs.mean, secondsFromMs),
      scenario.delta.durationMs === null
        ? '—'
        : signedNumber(scenario.delta.durationMs / 1000, 1),
    ),
  );
  rows.push(
    row(
      'Termination',
      h ? terminationBreakdown(h.termination) : '—',
      c ? terminationBreakdown(c.termination) : '—',
      '—',
    ),
  );
  rows.push(row('N', h ? String(h.n) : '—', c ? String(c.n) : '—', '—'));
  return rows.join('\n');
}

function renderJudgeBreakdown(scenario: ScenarioSummary): string | null {
  const allCriteria = new Set<string>();
  for (const cell of [scenario.cells.hyperdx, scenario.cells.clickhouse]) {
    if (!cell) continue;
    for (const id of Object.keys(cell.judge.perCriterion)) allCriteria.add(id);
  }
  if (allCriteria.size === 0) return null;
  const rows = [
    '#### Judge per-criterion (mean 0–5)',
    '',
    '| Criterion | HyperDX | ClickHouse |',
    '|---|---|---|',
  ];
  for (const id of [...allCriteria].sort()) {
    const h = scenario.cells.hyperdx?.judge.perCriterion[id];
    const c = scenario.cells.clickhouse?.judge.perCriterion[id];
    rows.push(`| ${id} | ${fmtScore(h)} | ${fmtScore(c)} |`);
  }
  return rows.join('\n');
}

function renderProgrammaticBreakdown(scenario: ScenarioSummary): string | null {
  const allChecks = new Set<string>();
  for (const cell of [scenario.cells.hyperdx, scenario.cells.clickhouse]) {
    if (!cell) continue;
    for (const id of Object.keys(cell.programmatic.perCheck)) allChecks.add(id);
  }
  if (allChecks.size === 0) return null;
  const rows = [
    '#### Programmatic per-check (pass rate)',
    '',
    'Pass rate = positive checks matched + negative checks not matched.',
    '',
    '| Check | HyperDX | ClickHouse |',
    '|---|---|---|',
  ];
  for (const id of [...allChecks].sort()) {
    const h = scenario.cells.hyperdx?.programmatic.perCheck[id];
    const c = scenario.cells.clickhouse?.programmatic.perCheck[id];
    const isNegative = id.startsWith('false_');
    const label = isNegative ? `${id} (neg)` : id;
    rows.push(`| ${label} | ${fmtRate(h)} | ${fmtRate(c)} |`);
  }
  return rows.join('\n');
}

function row(label: string, h: string, c: string, delta: string): string {
  return `| ${label} | ${h} | ${c} | ${delta} |`;
}

function val<T>(v: T | undefined, fmt: (x: T) => string): string {
  return v === undefined ? '—' : fmt(v);
}

function pct(x: number | undefined): string {
  if (x === undefined) return '—';
  return `${(x * 100).toFixed(0)}%`;
}

function signedPct(x: number | null | undefined): string {
  if (x === null || x === undefined) return '—';
  const sign = x >= 0 ? '+' : '';
  return `${sign}${(x * 100).toFixed(0)}%`;
}

function oneDecimal(x: number): string {
  return x.toFixed(1);
}

function intStr(x: number): string {
  return Math.round(x).toString();
}

function secondsFromMs(x: number): string {
  return (x / 1000).toFixed(1);
}

function signedNumber(x: number | null | undefined, decimals: number): string {
  if (x === null || x === undefined) return '—';
  const sign = x >= 0 ? '+' : '';
  return `${sign}${x.toFixed(decimals)}`;
}

function fmtScore(x: number | undefined): string {
  if (x === undefined) return '—';
  return `${x.toFixed(2)}/5`;
}

function fmtRate(x: number | undefined): string {
  if (x === undefined) return '—';
  return `${(x * 100).toFixed(0)}%`;
}

function terminationBreakdown(rec: Record<string, number>): string {
  const entries = Object.entries(rec).sort((a, b) => b[1] - a[1]);
  return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
