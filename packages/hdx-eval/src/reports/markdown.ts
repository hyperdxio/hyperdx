import type { McpKind } from '../harness/types';
import type {
  BatchSummary,
  CellSummary,
  DeltaSummary,
  ScenarioSummary,
} from './aggregate';

export function renderMarkdownReport(summary: BatchSummary): string {
  const lines: string[] = [];
  lines.push(`# Eval Batch — ${basename(summary.batchDir)}`);
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  if (summary.baseline) {
    lines.push(`Baseline: ${summary.baseline}`);
  }
  lines.push(`MCPs: ${summary.mcpOrder.join(', ')}`);
  lines.push('');
  lines.push(renderTopVerdict(summary));
  lines.push('');

  for (const scenario of summary.scenarios) {
    lines.push(`## ${scenario.scenario}`);
    lines.push('');
    lines.push(renderScenarioTable(scenario, summary.mcpOrder));
    lines.push('');
    const judgeBreakdown = renderJudgeBreakdown(scenario, summary.mcpOrder);
    if (judgeBreakdown) {
      lines.push(judgeBreakdown);
      lines.push('');
    }
    const programmaticBreakdown = renderProgrammaticBreakdown(
      scenario,
      summary.mcpOrder,
    );
    if (programmaticBreakdown) {
      lines.push(programmaticBreakdown);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function renderTopVerdict(summary: BatchSummary): string {
  const mcps = summary.mcpOrder;
  const baseline = summary.baseline;
  // Header: | Scenario | MCP1 | MCP2 | ... | Δ₁ | Δ₂ | ...
  const mcpHeaders = mcps.map(m => m).join(' | ');
  const challengers = mcps.filter(m => m !== baseline);
  const deltaHeaders =
    challengers.length > 0
      ? ' | ' + challengers.map(m => `Δ (${m})`).join(' | ')
      : '';
  const header = `| Scenario | ${mcpHeaders}${deltaHeaders} |`;
  const sep = '|---' + '|---'.repeat(mcps.length + challengers.length) + '|';

  const rows = [header, sep];
  for (const s of summary.scenarios) {
    const mcpCells = mcps.map(m => {
      const c = s.cells[m];
      return c ? pct(c.combinedScore.mean) : '—';
    });
    const deltaCells = challengers.map(m => {
      const d = s.deltas[m];
      return d?.combinedScore !== null && d?.combinedScore !== undefined
        ? signedPct(d.combinedScore)
        : '—';
    });
    const allCells = [...mcpCells, ...deltaCells];
    rows.push(`| ${s.scenario} | ${allCells.join(' | ')} |`);
  }
  return ['### Top-line verdict', '', ...rows].join('\n');
}

function renderScenarioTable(
  scenario: ScenarioSummary,
  mcpOrder: McpKind[],
): string {
  const baseline = scenario.baseline;
  const challengers = mcpOrder.filter(m => m !== baseline);
  const hasDelta = challengers.length > 0;

  // Build dynamic headers: | Metric | MCP1 | MCP2 | ... | Δ₁ | ...
  const mcpHeaders = mcpOrder.map(m => m).join(' | ');
  const deltaHeaders = hasDelta
    ? ' | ' + challengers.map(m => `Δ (${m})`).join(' | ')
    : '';
  const header = `| Metric | ${mcpHeaders}${deltaHeaders} |`;
  const sep =
    '|---' + '|---'.repeat(mcpOrder.length + challengers.length) + '|';

  const rows = [header, sep];

  const cellFor = (m: McpKind): CellSummary | undefined => scenario.cells[m];
  const deltaFor = (m: McpKind): DeltaSummary | undefined => scenario.deltas[m];

  function addRow(
    label: string,
    valueFn: (c: CellSummary | undefined) => string,
    deltaFn?: (d: DeltaSummary | undefined) => string,
  ) {
    const mcpCells = mcpOrder.map(m => valueFn(cellFor(m)));
    const deltaCells = hasDelta
      ? challengers.map(m => (deltaFn ? deltaFn(deltaFor(m)) : '—'))
      : [];
    rows.push(`| ${label} | ${[...mcpCells, ...deltaCells].join(' | ')} |`);
  }

  addRow(
    'Combined score',
    c => val(c?.combinedScore.mean, pct),
    d => signedPct(d?.combinedScore),
  );
  addRow(
    'Programmatic score',
    c => val(c?.programmatic.mean, pct),
    d => signedPct(d?.programmaticScore),
  );
  addRow(
    'Judge mean (weighted)',
    c => val(c?.judge.weightedMean, pct),
    d => signedPct(d?.judgeWeightedMean),
  );
  addRow(
    'Tool calls (mean)',
    c => val(c?.toolCalls.mean, oneDecimal),
    d => signedNumber(d?.toolCalls, 1),
  );
  addRow('Tool errors (mean)', c => val(c?.toolErrors?.mean, oneDecimal));
  addRow('Tool-error penalty', c =>
    val(c?.toolErrors?.penaltyMean, x => `${(x * 100).toFixed(0)}pp`),
  );
  addRow(
    'Output tokens (mean)',
    c => val(c?.tokens.output, intStr),
    d => signedNumber(d?.outputTokens, 0),
  );
  addRow('Cache reads (mean)', c => val(c?.tokens.cacheRead, intStr));
  addRow(
    'Wall clock (s, mean)',
    c => val(c?.durationMs.mean, secondsFromMs),
    d =>
      d?.durationMs !== null && d?.durationMs !== undefined
        ? signedNumber(d.durationMs / 1000, 1)
        : '—',
  );
  addRow('Termination', c => (c ? terminationBreakdown(c.termination) : '—'));
  addRow('N', c => (c ? String(c.n) : '—'));

  return rows.join('\n');
}

function renderJudgeBreakdown(
  scenario: ScenarioSummary,
  mcpOrder: McpKind[],
): string | null {
  const allCriteria = new Set<string>();
  for (const cell of Object.values(scenario.cells)) {
    if (!cell) continue;
    for (const id of Object.keys(cell.judge.perCriterion)) allCriteria.add(id);
  }
  if (allCriteria.size === 0) return null;

  const mcpHeaders = mcpOrder.join(' | ');
  const rows = [
    '#### Judge per-criterion (mean 0–5)',
    '',
    `| Criterion | ${mcpHeaders} |`,
    '|---' + '|---'.repeat(mcpOrder.length) + '|',
  ];
  for (const id of [...allCriteria].sort()) {
    const mcpCells = mcpOrder.map(m => {
      const v = scenario.cells[m]?.judge.perCriterion[id];
      return fmtScore(v);
    });
    rows.push(`| ${id} | ${mcpCells.join(' | ')} |`);
  }
  return rows.join('\n');
}

function renderProgrammaticBreakdown(
  scenario: ScenarioSummary,
  mcpOrder: McpKind[],
): string | null {
  const allChecks = new Set<string>();
  for (const cell of Object.values(scenario.cells)) {
    if (!cell) continue;
    for (const id of Object.keys(cell.programmatic.perCheck)) allChecks.add(id);
  }
  if (allChecks.size === 0) return null;

  const mcpHeaders = mcpOrder.join(' | ');
  const rows = [
    '#### Programmatic per-check (pass rate)',
    '',
    'Pass rate = positive checks matched + negative checks not matched.',
    '',
    `| Check | ${mcpHeaders} |`,
    '|---' + '|---'.repeat(mcpOrder.length) + '|',
  ];
  for (const id of [...allChecks].sort()) {
    const mcpCells = mcpOrder.map(m => {
      const v = scenario.cells[m]?.programmatic.perCheck[id];
      return fmtRate(v);
    });
    const isNegative = id.startsWith('false_');
    const label = isNegative ? `${id} (neg)` : id;
    rows.push(`| ${label} | ${mcpCells.join(' | ')} |`);
  }
  return rows.join('\n');
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
