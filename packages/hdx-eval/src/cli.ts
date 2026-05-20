#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'path';

import { createEvalClient, defaultClickHouseUrl } from './clickhouse/client';
import { dropScenarioTables, scenarioTables } from './clickhouse/schema';
import { gradeBatch, resolveBatchDir } from './grading/grade';
import { runCell } from './harness/runRun';
import type { McpKind, PromptVariant } from './harness/types';
import { configExists, configPath, readConfig } from './hyperdx/config';
import { runCheck, runSetup } from './hyperdx/setup';
import { writeBatchSummary } from './reports/store';
import { instrumentBatch, summarizeTimingRecord } from './runs/instrument';
import { batchDirName } from './runs/path';
import { writeRun } from './runs/store';
import { listBatches, listRunsInBatch, readRun } from './runs/store';
import { getScenario, SCENARIO_NAMES, SCENARIOS } from './scenarios';
import { seedScenario } from './scenarios/seedScenario';

type GlobalOpts = {
  chUrl?: string;
  chUser?: string;
  chPassword?: string;
};

function buildClient(opts: GlobalOpts) {
  return createEvalClient({
    url: opts.chUrl ?? defaultClickHouseUrl(),
    username: opts.chUser,
    password: opts.chPassword,
  });
}

function buildClientFromConfig(
  cfg: import('./hyperdx/config').EvalConfig,
  globals: GlobalOpts,
) {
  return createEvalClient({
    url:
      globals.chUrl ?? `http://${cfg.clickhouse.host}:${cfg.clickhouse.port}`,
    username: globals.chUser ?? cfg.clickhouse.user,
    password: globals.chPassword ?? cfg.clickhouse.password,
  });
}

function defaultApiUrl(): string {
  if (process.env.HDX_EVAL_API_URL) return process.env.HDX_EVAL_API_URL;
  if (process.env.HYPERDX_API_PORT) {
    return `http://localhost:${process.env.HYPERDX_API_PORT}`;
  }
  if (process.env.HDX_DEV_API_PORT) {
    return `http://localhost:${process.env.HDX_DEV_API_PORT}`;
  }
  return 'http://localhost:8000';
}

const program = new Command();

program
  .name('hdx-eval')
  .description(
    'HyperDX eval framework — synthetic telemetry generators + agent harness',
  )
  .option('--ch-url <url>', 'ClickHouse HTTP URL')
  .option('--ch-user <user>', 'ClickHouse username', 'default')
  .option('--ch-password <password>', 'ClickHouse password', '');

program
  .command('list')
  .description('List available scenarios')
  .action(() => {
    for (const name of SCENARIO_NAMES) {
      const s = SCENARIOS[name];
      const tables = scenarioTables(name);
      console.log(`\n${name}`);
      console.log(`  prompt: ${s.agentPrompt}`);
      console.log(`  description: ${s.description}`);
      console.log(`  tables: default.${tables.traces}, default.${tables.logs}`);
    }
    console.log();
  });

program
  .command('seed <scenario>')
  .description('Seed ClickHouse with synthetic data for the given scenario')
  .option('--seed <n>', 'PRNG seed', '42')
  .option('--now <iso>', 'Anchor "now" to a fixed ISO timestamp')
  .option(
    '--volume-factor <f>',
    'Scale background row counts (e.g. 0.1 for 10% of full volume)',
  )
  .action(
    async (
      scenarioName: string,
      cmdOpts: { seed: string; now?: string; volumeFactor?: string },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const seedNum = Number(cmdOpts.seed);
      if (!Number.isFinite(seedNum)) {
        throw new Error(`--seed must be a number, got: ${cmdOpts.seed}`);
      }
      const nowMs = cmdOpts.now ? Date.parse(cmdOpts.now) : Date.now();
      if (cmdOpts.now && !Number.isFinite(nowMs)) {
        throw new Error(
          `--now must be a valid ISO timestamp, got: ${cmdOpts.now}`,
        );
      }
      let volumeFactor: number | undefined;
      if (cmdOpts.volumeFactor !== undefined) {
        volumeFactor = Number(cmdOpts.volumeFactor);
        if (!Number.isFinite(volumeFactor) || volumeFactor <= 0) {
          throw new Error(
            `--volume-factor must be a positive number, got: ${cmdOpts.volumeFactor}`,
          );
        }
      }

      const scenario = getScenario(scenarioName);
      console.log(`Seeding scenario "${scenario.name}"`);
      console.log(`  seed: ${seedNum}`);
      console.log(`  now:  ${new Date(nowMs).toISOString()}`);
      if (volumeFactor !== undefined) {
        console.log(`  volumeFactor: ${volumeFactor}`);
      }

      const client = buildClient(opts);
      try {
        const result = await seedScenario({
          client,
          scenarioName: scenario.name,
          seed: seedNum,
          nowMs,
          volumeFactor,
        });
        console.log(
          `Inserted ${result.tracesInserted} trace rows → default.${result.tables.traces}`,
        );
        console.log(
          `Inserted ${result.logsInserted} log rows    → default.${result.tables.logs}`,
        );
      } finally {
        await client.close();
      }
    },
  );

program
  .command('drop <scenario>')
  .description('Drop the eval tables for the given scenario')
  .action(async (scenarioName: string) => {
    const opts = program.opts<GlobalOpts>();
    getScenario(scenarioName);
    const client = buildClient(opts);
    try {
      await dropScenarioTables(client, scenarioName);
      const tables = scenarioTables(scenarioName);
      console.log(
        `Dropped default.${tables.traces} and default.${tables.logs}`,
      );
    } finally {
      await client.close();
    }
  });

program
  .command('setup-hyperdx')
  .description(
    'One-time setup: register/login + create Connection + per-scenario Sources',
  )
  .option('--api-url <url>', 'HyperDX API URL', defaultApiUrl())
  .option('--email <email>', 'Account email', 'eval@local.test')
  .option('--password <pw>', 'Account password', 'EvalPass123!#')
  .option(
    '--creds-file <path>',
    'JSON file with {"email":..., "password":...} (overrides --email/--password)',
  )
  .option('--check', 'Validate existing config instead of creating')
  .option(
    '--reset-sources',
    'Delete and recreate all eval-* Sources (e.g. to apply new querySettings)',
  )
  .action(
    async (cmdOpts: {
      apiUrl: string;
      email: string;
      password: string;
      credsFile?: string;
      check?: boolean;
      resetSources?: boolean;
    }) => {
      const opts = program.opts<GlobalOpts>();
      let email = cmdOpts.email;
      let password = cmdOpts.password;
      if (cmdOpts.credsFile) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('fs') as typeof import('fs');
        const expanded = cmdOpts.credsFile.replace(
          /^~(?=$|\/|\\)/,
          process.env.HOME ?? '~',
        );
        const raw = JSON.parse(fs.readFileSync(expanded, 'utf8'));
        if (typeof raw.email !== 'string' || typeof raw.password !== 'string') {
          throw new Error(
            `--creds-file must be a JSON object with string fields "email" and "password"`,
          );
        }
        email = raw.email;
        password = raw.password;
      }
      if (cmdOpts.check) {
        const result = await runCheck();
        console.log(
          'Config:           ',
          result.configOk ? 'OK' : 'MISSING/INVALID',
        );
        console.log(
          'HyperDX MCP:      ',
          result.mcpReachable ? 'OK' : 'UNREACHABLE',
        );
        console.log(
          'ClickHouse:       ',
          result.clickhouseReachable ? 'OK' : 'UNREACHABLE',
        );
        console.log(
          'uv installed:     ',
          result.uvAvailable ? 'OK' : 'MISSING',
        );
        if (result.errors.length > 0) {
          console.log('\nErrors:');
          for (const e of result.errors) console.log('  -', e);
          process.exit(1);
        }
        return;
      }

      const chUrl = opts.chUrl ?? defaultClickHouseUrl();
      const url = new URL(chUrl);
      console.log(`Setting up HyperDX eval account at ${cmdOpts.apiUrl}`);
      const result = await runSetup({
        apiUrl: cmdOpts.apiUrl,
        email,
        password,
        clickhouse: {
          host: url.hostname,
          port: url.port || '8123',
          user: opts.chUser ?? 'default',
          password: opts.chPassword ?? '',
        },
        resetSources: cmdOpts.resetSources ?? false,
      });
      console.log(`Wrote ${result.configPath}`);
      console.log(
        `  connection: ${result.created.connection ? 'created' : 'already existed'}`,
      );
      if (result.created.sources.length === 0) {
        console.log('  sources:    all already existed');
      } else {
        console.log('  sources:    created', result.created.sources.join(', '));
      }
    },
  );

program
  .command('run <scenario>')
  .description(
    'Run Claude Code as the agent against one or both MCPs and capture trajectories',
  )
  .option('--mcp <kind>', 'hyperdx | clickhouse | both', 'both')
  .option('--runs <n>', 'Number of runs per (scenario,MCP) cell', '3')
  .option(
    '--model <id>',
    'Model ID to pass to Claude Code',
    'claude-sonnet-4-6',
  )
  // Lower than the previous 25 — tightens the budget so sloppy agents that
  // make 20+ exploratory calls can't paper over correctness with volume.
  // Override with --max-turns if a specific scenario needs more.
  .option('--max-turns <n>', 'Max tool-use turns', '15')
  .option('--seed <n>', 'PRNG seed for re-seeding', '42')
  .option(
    '--timeout <ms>',
    'Per-run wall-clock timeout in milliseconds',
    '300000',
  )
  .option('--no-reseed', 'Skip the re-seed step (use existing data as-is)')
  .option(
    '--anchor-time <iso>',
    'Fixed "now" anchor for both seed and agent system prompt. When set, ' +
      'the agent treats this timestamp as the current time for relative ' +
      'window references in the user prompt. Required when running with ' +
      '--no-reseed against a shared-anchor batch seed.',
  )
  .option(
    '--concurrency <n>',
    'Run up to N cells concurrently within this scenario. Default 1 ' +
      '(sequential). Each cell is one (mcp, runIndex) pair.',
    '1',
  )
  .option(
    '--prompt-variant <name>',
    'Prompt variant: "baseline" (default) or "hypothesis" (forces the ' +
      'agent to enumerate 2-4 hypotheses up front and spawn one Task ' +
      'subagent per hypothesis to investigate in parallel). The hypothesis ' +
      'variant also allows the Task built-in tool; the baseline variant ' +
      'denies it.',
    'baseline',
  )
  .action(
    async (
      scenarioName: string,
      cmdOpts: {
        mcp: string;
        runs: string;
        model: string;
        maxTurns: string;
        seed: string;
        timeout: string;
        reseed: boolean;
        anchorTime?: string;
        concurrency: string;
        promptVariant: string;
      },
    ) => {
      const opts = program.opts<GlobalOpts>();
      const scenario = getScenario(scenarioName);
      const apiKeyEnv = process.env.ANTHROPIC_API_KEY;
      if (!apiKeyEnv) {
        throw new Error(
          'ANTHROPIC_API_KEY is not set. Export it before running `hdx-eval run`.',
        );
      }
      const apiKey: string = apiKeyEnv;
      if (!configExists()) {
        throw new Error(
          `Eval config missing. Run \`hdx-eval setup-hyperdx\` first. Expected: ${configPath()}`,
        );
      }
      const config = readConfig();

      const mcpKinds: McpKind[] = parseMcpFlag(cmdOpts.mcp);
      const promptVariant: PromptVariant = parsePromptVariant(
        cmdOpts.promptVariant,
      );
      const runs = Number(cmdOpts.runs);
      const maxTurns = Number(cmdOpts.maxTurns);
      const timeoutMs = Number(cmdOpts.timeout);
      const seedNum = Number(cmdOpts.seed);
      const concurrency = Number(cmdOpts.concurrency);
      for (const [k, v] of Object.entries({
        runs,
        maxTurns,
        timeoutMs,
        seedNum,
        concurrency,
      })) {
        if (!Number.isFinite(v) || v <= 0) {
          throw new Error(
            `--${k.replace(/Num$/, '')} must be a positive number`,
          );
        }
      }

      let anchorTimeIso: string | undefined;
      let anchorMs: number;
      if (cmdOpts.anchorTime) {
        anchorMs = Date.parse(cmdOpts.anchorTime);
        if (!Number.isFinite(anchorMs)) {
          throw new Error(
            `--anchor-time must be a valid ISO timestamp, got: ${cmdOpts.anchorTime}`,
          );
        }
        anchorTimeIso = new Date(anchorMs).toISOString();
      } else {
        anchorMs = Date.now();
        anchorTimeIso = undefined; // no anchor injection when running live
      }

      // Re-seed once before running so timestamps are anchored to the chosen
      // "now". Skip if --no-reseed was passed (e.g. shared-anchor batch seed).
      if (cmdOpts.reseed !== false) {
        const client = buildClientFromConfig(config, opts);
        try {
          const r = await seedScenario({
            client,
            scenarioName: scenario.name,
            seed: seedNum,
            nowMs: anchorMs,
          });
          console.log(
            `Re-seeded ${scenario.name}: ${r.tracesInserted} traces, ${r.logsInserted} logs (now=${new Date(anchorMs).toISOString()})`,
          );
        } finally {
          await client.close();
        }
      }

      const batchDir = batchDirName();
      console.log(`\nBatch: runs/${batchDir}`);
      console.log(`Scenario: ${scenario.name}`);
      console.log(`MCPs: ${mcpKinds.join(', ')}`);
      console.log(
        `Runs/cell: ${runs}, model: ${cmdOpts.model}, max-turns: ${maxTurns}, concurrency: ${concurrency}, prompt-variant: ${promptVariant}\n`,
      );

      type SummaryRow = {
        mcp: McpKind;
        i: number;
        toolCalls: number;
        inputTokens: number;
        outputTokens: number;
        durationS: number;
        termination: string;
        path: string;
      };

      // Flatten the (mcp, runIndex) matrix into a single queue and pull from it
      // with a worker pool of size `concurrency`.
      const cells: Array<{ mcp: McpKind; i: number }> = [];
      for (const mcp of mcpKinds) {
        for (let i = 0; i < runs; i++) cells.push({ mcp, i });
      }

      const summary: SummaryRow[] = [];
      let cursor = 0;
      async function worker(workerId: number): Promise<void> {
        while (true) {
          const idx = cursor++;
          if (idx >= cells.length) return;
          const { mcp, i } = cells[idx];
          const label = concurrency > 1 ? `[w${workerId}] ` : '  ';
          process.stdout.write(
            `${label}${mcp} run ${i + 1}/${runs}... starting\n`,
          );
          const startedMs = Date.now();
          const record = await runCell({
            config,
            scenario: scenario.name,
            agentPrompt: scenario.agentPrompt,
            mcp,
            model: cmdOpts.model,
            maxTurns,
            timeoutMs,
            runIndex: i,
            seed: seedNum,
            apiKey,
            anchorTimeIso,
            promptVariant,
          });
          const path = writeRun({ record, batchDir });
          const seconds = ((Date.now() - startedMs) / 1000).toFixed(1);
          console.log(
            `${label}${mcp} run ${i + 1}/${runs}: ${record.termination} · ${record.toolCalls.length} tool calls · ${record.tokens.input}+${record.tokens.output} tok · ${seconds}s`,
          );
          summary.push({
            mcp,
            i,
            toolCalls: record.toolCalls.length,
            inputTokens: record.tokens.input,
            outputTokens: record.tokens.output,
            durationS: Math.round((Date.now() - startedMs) / 100) / 10,
            termination: record.termination,
            path,
          });
        }
      }
      const workerCount = Math.min(concurrency, cells.length);
      await Promise.all(
        Array.from({ length: workerCount }, (_, w) => worker(w + 1)),
      );

      console.log('\nResults written under runs/' + batchDir);
      // Sort by (mcp, i) for stable summary output even with parallel workers.
      summary.sort((a, b) => a.mcp.localeCompare(b.mcp) || a.i - b.i);
      for (const row of summary) {
        console.log(
          `  ${row.mcp.padEnd(10)} #${row.i}  ${row.termination.padEnd(13)}  tools=${row.toolCalls}  tokens=${row.inputTokens}+${row.outputTokens}  ${row.durationS}s`,
        );
      }
    },
  );

program
  .command('runs-list')
  .description('List recorded run batches')
  .action(() => {
    const batches = listBatches();
    if (batches.length === 0) {
      console.log('No runs recorded yet.');
      return;
    }
    for (const b of batches) {
      const files = listRunsInBatch(b);
      console.log(
        `${b}  (${files.length} run${files.length === 1 ? '' : 's'})`,
      );
    }
  });

program
  .command('runs-show <path>')
  .description('Pretty-print a run record file')
  .option(
    '--queries',
    'Print every tool call with its full input (SQL / builder spec) and any matching query_log rows from the timing sidecar',
  )
  .option(
    '--final-answer',
    'Print the final answer (omitted by default to keep --queries output focused)',
  )
  .action(
    (path: string, cmdOpts: { queries?: boolean; finalAnswer?: boolean }) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs') as typeof import('fs');
      const r = readRun(path);
      console.log(`Run ${r.runId}`);
      console.log(`  scenario:   ${r.scenario}`);
      console.log(`  mcp:        ${r.mcp}`);
      console.log(`  model:      ${r.model}`);
      console.log(
        `  termination: ${r.termination} (exit ${r.exitCode ?? '?'})`,
      );
      console.log(`  duration:   ${(r.durationMs / 1000).toFixed(1)}s`);
      console.log(
        `  tokens:     in=${r.tokens.input} out=${r.tokens.output} cacheRead=${r.tokens.cacheRead}`,
      );
      console.log(`  tool calls: ${r.toolCalls.length}`);

      if (cmdOpts.queries) {
        const timingPath = path.replace(/\.json$/, '.timing.json');
        const timing = fs.existsSync(timingPath)
          ? (JSON.parse(fs.readFileSync(timingPath, 'utf8')) as {
              toolCalls: Array<{
                index: number;
                serverQueries: Array<{
                  queryDurationMs: number;
                  readRows: number;
                  queryPreview: string;
                }>;
              }>;
            } | null)
          : null;
        console.log('\n--- Tool calls ---');
        r.toolCalls.forEach((c, i) => {
          const inp = c.input as Record<string, unknown>;
          let summary: string;
          if (c.name === 'mcp__clickhouse__run_query') {
            summary = `query=${String(inp?.query ?? '')
              .replace(/\s+/g, ' ')
              .trim()}`;
          } else if (c.name === 'mcp__hyperdx__hyperdx_query') {
            if (inp?.displayType === 'sql') {
              summary = `[sql] ${String(inp?.sql ?? '')
                .replace(/\s+/g, ' ')
                .trim()}`;
            } else {
              summary = `[${inp?.displayType ?? '?'}] where=${inp?.where ?? '—'}  groupBy=${inp?.groupBy ?? '—'}  select=${JSON.stringify(inp?.select ?? null)}`;
            }
          } else {
            summary = JSON.stringify(inp).slice(0, 200);
          }
          console.log(`\n#${i + 1} ${c.name}`);
          console.log(`   ${summary}`);
          const t = timing?.toolCalls?.[i];
          if (t && t.serverQueries.length > 0) {
            for (const q of t.serverQueries) {
              console.log(
                `   └─ server: ${q.queryDurationMs}ms, read=${q.readRows}  ${q.queryPreview.replace(/\s+/g, ' ').slice(0, 140)}`,
              );
            }
          }
        });
      }

      if (cmdOpts.finalAnswer) {
        console.log(`\n--- Final answer ---\n${r.finalAnswer}\n`);
      }
    },
  );

program
  .command('grade <batch>')
  .description(
    'Grade trajectories: programmatic checks + LLM-as-judge (Opus 4.7 by default)',
  )
  .option('--judge-model <id>', 'Judge model ID', 'claude-opus-4-7')
  .option('--rerun-judge', 'Re-call judge even if a grade JSON already exists')
  .option('--no-judge', 'Run programmatic checks only (cheap regrade)')
  .action(
    async (
      batch: string,
      cmdOpts: { judgeModel: string; rerunJudge?: boolean; judge: boolean },
    ) => {
      const dir = resolveBatchDir(batch);
      console.log(`Grading batch at ${dir}`);
      const summary = await gradeBatch(dir, {
        judgeModel: cmdOpts.judgeModel,
        rerunJudge: cmdOpts.rerunJudge ?? false,
        skipJudge: cmdOpts.judge === false,
      });
      console.log(
        `\nGraded ${summary.graded.length} run${summary.graded.length === 1 ? '' : 's'}; ${summary.errors.length} error${summary.errors.length === 1 ? '' : 's'}.`,
      );
      if (summary.errors.length > 0) {
        for (const e of summary.errors) console.log('  -', e.runPath, e.error);
        process.exit(1);
      }
    },
  );

program
  .command('runs-instrument <batch>')
  .description(
    'Enrich each run with per-tool-call query_log timings from ClickHouse',
  )
  .action(async (batch: string) => {
    const opts = program.opts<GlobalOpts>();
    const cfgPath = configExists() ? configPath() : null;
    let chUrl = opts.chUrl;
    let chUser = opts.chUser;
    let chPassword = opts.chPassword;
    if (!chUrl && cfgPath) {
      const cfg = readConfig();
      chUrl = `http://${cfg.clickhouse.host}:${cfg.clickhouse.port}`;
      chUser = chUser ?? cfg.clickhouse.user;
      chPassword = chPassword ?? cfg.clickhouse.password;
    }
    chUrl = chUrl ?? defaultClickHouseUrl();
    const records = await instrumentBatch(batch, {
      clickhouseUrl: chUrl,
      username: chUser,
      password: chPassword,
    });
    for (const r of records) {
      console.log('  ' + summarizeTimingRecord(r));
    }
    console.log(`\nWrote ${records.length} *.timing.json sidecars.`);
  });

program
  .command('report <batch>')
  .description('Render markdown + JSON summary from grade JSONs in the batch')
  .option('--out <path>', 'Output markdown path (default: <batch>/_summary.md)')
  .action(async (batch: string, cmdOpts: { out?: string }) => {
    const dir = resolveBatchDir(batch);
    const out = resolve(cmdOpts.out ?? `${dir}/_summary.md`);
    const result = writeBatchSummary(dir, out);
    console.log(`Wrote ${result.mdPath}`);
    console.log(`Wrote ${result.jsonPath}`);
    console.log(
      `Aggregated ${result.pairsCount} run${result.pairsCount === 1 ? '' : 's'}.`,
    );
  });

function parseMcpFlag(v: string): McpKind[] {
  if (v === 'both') return ['hyperdx', 'clickhouse'];
  if (v === 'hyperdx' || v === 'clickhouse') return [v];
  throw new Error(`--mcp must be hyperdx | clickhouse | both, got: ${v}`);
}

function parsePromptVariant(v: string): PromptVariant {
  if (v === 'baseline' || v === 'hypothesis') return v;
  throw new Error(
    `--prompt-variant must be "baseline" or "hypothesis", got: ${v}`,
  );
}

program.parseAsync(process.argv).catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
