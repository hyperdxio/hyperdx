import type { GradeRecord } from '@/grading/types';
import type { RunRecord } from '@/harness/types';
import { buildAggregate, type GradedRunPair } from '@/reports/aggregate';
import { renderMarkdownReport } from '@/reports/markdown';

function pair(
  scenario: string,
  mcp: string,
  i: number,
  plugin = 'none',
  adoption?: { score: number; hits: Array<{ id: string; satisfied: boolean }> },
): GradedRunPair {
  const run: RunRecord = {
    schemaVersion: 1,
    runId: `${scenario}-${mcp}-${plugin}-${i}`,
    scenario,
    mcp,
    model: 'claude-sonnet-4-6',
    plugin,
    runIndex: i,
    seed: 42,
    startedAt: '2026-05-09T07:50:00.000Z',
    endedAt: '2026-05-09T07:51:00.000Z',
    durationMs: 60_000,
    agentPrompt: 'p',
    systemPromptAppend: 's',
    termination: 'final_answer',
    exitCode: 0,
    tools: [],
    toolCalls: [],
    messages: [],
    finalAnswer: 'a',
    tokens: { input: 50, output: 1000, cacheCreation: 0, cacheRead: 5000 },
    totalCostUsd: 0.01,
    stderr: '',
  };
  const grade: GradeRecord = {
    schemaVersion: 2,
    runId: run.runId,
    scenario,
    mcp,
    programmatic: {
      hits: [{ id: 'names_root', weight: 1, matched: true, satisfied: true }],
      score: 1,
    },
    judge: {
      model: 'claude-opus-4-7',
      scores: {
        correctness: { score: 5, rationale: '' },
        completeness: { score: 4, rationale: '' },
      },
      weightedScore: 0.9,
      rawResponse: '',
      durationMs: 1000,
      tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    },
    toolErrors: { total: 1, errors: 0, rate: 0, penalty: 0, samples: [] },
    combinedScore: 0.94,
    gradedAt: '',
    judgeModel: 'claude-opus-4-7',
  };
  if (adoption) {
    grade.adoption = {
      score: adoption.score,
      hits: adoption.hits.map(h => ({
        id: h.id,
        weight: 1,
        matched: h.satisfied,
        satisfied: h.satisfied,
      })),
    };
  }
  return { run, grade };
}

describe('renderMarkdownReport', () => {
  const summary = buildAggregate({
    batchDir: '/tmp/2026-05-09T07-50-58-566Z',
    pairs: [
      pair('error-root-cause', 'hyperdx', 0),
      pair('error-root-cause', 'clickhouse', 0),
      pair('latency-spike', 'hyperdx', 0),
      pair('latency-spike', 'clickhouse', 0),
    ],
  });
  const md = renderMarkdownReport(summary);

  it('renders a top-line verdict table', () => {
    expect(md).toContain('### Top-line verdict');
    // Dynamic column headers with MCP names
    expect(md).toContain('clickhouse');
    expect(md).toContain('hyperdx');
  });

  it('emits a section per scenario', () => {
    expect(md).toContain('## error-root-cause');
    expect(md).toContain('## latency-spike');
  });

  it('includes all summary metrics in each scenario table', () => {
    expect(md).toContain('Combined score');
    expect(md).toContain('Programmatic score');
    expect(md).toContain('Judge mean (weighted)');
    expect(md).toContain('Tool calls (mean)');
    expect(md).toContain('Output tokens (mean)');
    expect(md).toContain('Wall clock (s, mean)');
    expect(md).toContain('Termination');
  });

  it('formats deltas with explicit sign', () => {
    // hyperdx and clickhouse have identical fixtures → delta is 0
    expect(md).toMatch(/\+0%|\+0\.0/);
  });

  it('emits judge per-criterion breakdown when judge data is present', () => {
    expect(md).toContain('Judge per-criterion (mean 0–5)');
    expect(md).toContain('correctness');
    expect(md).toContain('completeness');
  });

  it('emits programmatic per-check breakdown', () => {
    expect(md).toContain('Programmatic per-check (pass rate)');
    expect(md).toContain('names_root');
  });

  it('omits the adoption row and breakdown when no cell has adoption', () => {
    expect(md).not.toContain('Adoption (tool use)');
    expect(md).not.toContain('Adoption per-check');
  });

  it('uses the batch basename in the title', () => {
    expect(md.split('\n')[0]).toContain('2026-05-09T07-50-58-566Z');
  });

  it('shows MCPs and baseline in the header', () => {
    expect(md).toContain('MCPs: clickhouse, hyperdx');
    expect(md).toContain('Baseline: clickhouse');
  });
});

describe('renderMarkdownReport with adoption data', () => {
  const adopt = (score: number, used: boolean, named: boolean) => ({
    score,
    hits: [
      { id: 'used_metric_tool', satisfied: used },
      { id: 'named_jvm_memory', satisfied: named },
    ],
  });
  const summary = buildAggregate({
    batchDir: '/tmp/2026-05-09T07-50-58-566Z',
    pairs: [
      pair(
        'metric-saturation',
        'clickhouse',
        0,
        'none',
        adopt(0, false, false),
      ),
      pair('metric-saturation', 'hyperdx', 0, 'none', adopt(1, true, true)),
    ],
  });
  const md = renderMarkdownReport(summary);

  it('adds an "Adoption (tool use)" row to the scenario metrics table', () => {
    expect(md).toContain('Adoption (tool use)');
  });

  it('emits an adoption per-check breakdown with the check ids and a delta', () => {
    expect(md).toContain('Adoption per-check (usage rate)');
    expect(md).toContain('used_metric_tool');
    expect(md).toContain('named_jvm_memory');
    // hyperdx (challenger) adoption 1.0 vs clickhouse (baseline) 0.0 → +100%.
    expect(md).toContain('+100%');
  });
});

describe('renderMarkdownReport with plugin arms', () => {
  const summary = buildAggregate({
    batchDir: '/tmp/2026-05-09T07-50-58-566Z',
    pairs: [
      pair('error-root-cause', 'hyperdx', 0),
      pair('error-root-cause', 'hyperdx', 0, 'myplugin'),
    ],
  });
  const md = renderMarkdownReport(summary);

  it('uses plugin column keys and the mcp/plugin format hint in the header', () => {
    expect(md).toContain(
      'Columns: hyperdx/myplugin, hyperdx/none  _(mcp/plugin)_',
    );
    expect(md).toContain('Baseline: hyperdx/myplugin');
  });

  it('renders a delta column for the challenger plugin arm', () => {
    expect(md).toContain('Δ (hyperdx/none)');
  });
});

describe('renderMarkdownReport with model and plugin arms', () => {
  const modelPair = pair('error-root-cause', 'hyperdx', 0);
  modelPair.run.model = 'claude-haiku-4-5';
  const summary = buildAggregate({
    batchDir: '/tmp/2026-05-09T07-50-58-566Z',
    pairs: [modelPair, pair('error-root-cause', 'hyperdx', 0, 'myplugin')],
  });
  const md = renderMarkdownReport(summary);

  it('uses the mcp/model+plugin format hint when both vary', () => {
    expect(md).toContain('_(mcp/model+plugin)_');
    expect(md).toContain('hyperdx/claude-haiku-4-5+none');
    expect(md).toContain('hyperdx/claude-sonnet-4-6+myplugin');
  });
});
