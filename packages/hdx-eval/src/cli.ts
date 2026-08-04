#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs';
import { resolve } from 'path';

import { createEvalClient, defaultClickHouseUrl } from './clickhouse/client';
import {
  dropScenarioTables,
  scenarioIsSeeded,
  scenarioSlug,
  scenarioTables,
} from './clickhouse/schema';
import { buildBlindingEntries } from './grading/blind';
import {
  gradeBatch,
  type GradeBatchOptions,
  resolveBatchDir,
} from './grading/grade';
import { DEFAULT_JUDGE_SPEC, parseJudgeSpec } from './grading/judgeModel';
import { runCell } from './harness/runRun';
import { type McpKind, PLUGIN_NONE, type PromptVariant } from './harness/types';
import {
  configExists,
  configMcpNames,
  configPath,
  configPluginNames,
  enabledMcpNames,
  ensureAnchorTime,
  type EvalConfig,
  getMcpDefinition,
  getPluginDefinition,
  readConfig,
} from './hyperdx/config';
import { runCheck, runSetup } from './hyperdx/setup';
import { columnKeyFor } from './reports/aggregate';
import { writeBatchSummary } from './reports/store';
import { instrumentBatch, summarizeTimingRecord } from './runs/instrument';
import { batchDirName } from './runs/path';
import { writeRun } from './runs/store';
import { listBatches, listRunsInBatch, readRun } from './runs/store';
import { getScenario, SCENARIO_NAMES, SCENARIOS } from './scenarios';
import {
  getTotalMetrics,
  type SeedProgress,
  seedScenario,
} from './scenarios/seedScenario';

if (!process.env.ANTHROPIC_API_KEY && process.env.AI_API_KEY) {
  process.env.ANTHROPIC_API_KEY = process.env.AI_API_KEY;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function logSeedProgress(prefix: string, startMs: number) {
  return (p: SeedProgress) => {
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(0);
    const totalMetrics = getTotalMetrics(p.metricsInserted);
    const total = p.tracesInserted + p.logsInserted + totalMetrics;

    const totalRows = `${formatCount(total)} rows`;
    const tracesRows = `${formatCount(p.tracesInserted)} traces`;
    const logsRows = `${formatCount(p.logsInserted)} logs`;
    const metricsRows = `${formatCount(totalMetrics)} metrics`;

    process.stdout.write(
      `\r${prefix}${totalRows} (${tracesRows}, ${logsRows}, ${metricsRows}) · ${elapsed}s`,
    );
  };
}

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
      globals.chUrl ??
      (cfg.clickhouse
        ? `http://${cfg.clickhouse.host}:${cfg.clickhouse.port}`
        : defaultClickHouseUrl()),
    username: globals.chUser ?? cfg.clickhouse?.user,
    password: globals.chPassword ?? cfg.clickhouse?.password,
  });
}

/** Shared builder for post-run inspection config used by both `run` and `grade`. */
function buildInspectionConfig(
  config: EvalConfig,
  creds: { email: string; password: string },
  anchorTimeIso?: string,
):
  | NonNullable<import('./grading/grade').GradeBatchOptions['inspectionConfig']>
  | undefined {
  if (!config.hyperdxApi) return undefined;
  return {
    apiUrl: config.hyperdxApi.apiUrl,
    accessKey: config.hyperdxApi.accessKey,
    email: creds.email,
    password: creds.password,
    anchorTimeIso,
    cleanup: true,
  };
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

// Default eval account credentials — used by setup-hyperdx, run, and grade.
const DEFAULT_EVAL_EMAIL = 'eval@local.test';
const DEFAULT_EVAL_PASSWORD = 'EvalPass123!#';

// Global fallback turn budget when neither --max-turns nor a per-scenario
// `maxTurns` override is set. Kept low so exploratory over-querying is
// penalized; scenarios that need more headroom set `maxTurns` on themselves.
const DEFAULT_MAX_TURNS = 15;

/**
 * Resolve the judge model spec with precedence:
 *   CLI --judge-model flag > eval.config.json `grading.judgeModel` > built-in.
 * Validates the resulting spec so a bad `provider:model` fails fast at the CLI.
 */
function resolveJudgeModelSpec(flagValue: string | undefined): string {
  let configValue: string | undefined;
  if (configExists()) {
    try {
      configValue = readConfig().grading?.judgeModel;
    } catch {
      // Config may be stale/invalid — fall back to flag/default.
    }
  }
  const spec = flagValue ?? configValue ?? DEFAULT_JUDGE_SPEC;
  // Throws with a clear message on an unknown provider or empty model.
  return parseJudgeSpec(spec).spec;
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
        const seedStart = Date.now();
        const result = await seedScenario({
          client,
          scenarioName: scenario.name,
          seed: seedNum,
          nowMs,
          volumeFactor,
          onProgress: logSeedProgress('  seeding: ', seedStart),
        });
        const seedSecs = ((Date.now() - seedStart) / 1000).toFixed(1);
        process.stdout.write('\n');
        console.log(
          `Inserted ${result.tracesInserted} trace rows → default.${result.tables.traces}`,
        );
        console.log(
          `Inserted ${result.logsInserted} log rows    → default.${result.tables.logs}`,
        );
        const totalMetrics = getTotalMetrics(result.metricsInserted);
        if (totalMetrics > 0) {
          const m = result.metricsInserted;
          console.log(
            `Inserted ${totalMetrics} metric rows → default.eval_${scenarioSlug(scenario.name)}_otel_metrics_* ` +
              `(gauge ${m.gauge}, sum ${m.sum}, histogram ${m.histogram}, ` +
              `exp-histogram ${m.exponentialHistogram}, summary ${m.summary})`,
          );
        }
        console.log(`Done in ${seedSecs}s`);
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
  .option('--email <email>', 'Account email', DEFAULT_EVAL_EMAIL)
  .option('--password <pw>', 'Account password', DEFAULT_EVAL_PASSWORD)
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
    'Run Claude Code as the agent against one or more MCPs and capture trajectories',
  )
  .option(
    '--mcp <names>',
    'Comma-separated MCP names from config, or "all" (default: all)',
    'all',
  )
  .option(
    '--plugin <names>',
    'Comma-separated Claude Code plugin variants from config (like --mcp/--model). ' +
      'The literal "none" is the no-plugin variant. Default when omitted: "none". ' +
      'Pass "none,<name>" to compare a plugin against the no-plugin baseline.',
  )
  .option(
    '--baseline <name>',
    'Column key to use as baseline in reports. Keys are the MCP name, plus ' +
      '"/<model>", "/<plugin>", or "/<model>+<plugin>" when models/plugins ' +
      'vary (default: the first listed mcp/model/plugin variants)',
  )
  .option('--runs <n>', 'Number of runs per (scenario,MCP) cell', '3')
  .option(
    '--model <ids>',
    'Comma-separated model IDs to pass to Claude Code. When multiple ' +
      'models are given, every (mcp, model) pair is compared in reports.',
    'claude-opus-4-6',
  )
  // No commander default: an omitted flag stays `undefined` so we can tell
  // "user explicitly passed a value" apart from "not passed" and apply the
  // precedence CLI > scenario.maxTurns > DEFAULT_MAX_TURNS.
  .option(
    '--max-turns <n>',
    `Max tool-use turns. Overrides the per-scenario budget (fallback: ${DEFAULT_MAX_TURNS})`,
  )
  .option('--seed <n>', 'PRNG seed for re-seeding', '42')
  .option(
    '--timeout <ms>',
    'Per-run wall-clock timeout in milliseconds',
    '300000',
  )
  .option(
    '--reseed',
    'Re-seed ClickHouse data before running (default: skip reseed and reuse ' +
      'existing data). Use after changing seed parameters or when data is stale.',
  )
  .option(
    '--anchor-time <iso>',
    'Override the saved "now" anchor with a specific ISO timestamp. ' +
      'Saved to eval.config.json for future runs.',
  )
  .option(
    '--live',
    'Ignore the saved anchor time and use wall-clock "now". ' +
      'The agent will NOT receive a FIXED CURRENT TIME system prompt block. ' +
      'Implies --reseed since data must be seeded to the current time.',
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
  .option('--no-grade', 'Skip automatic grading after runs complete')
  .option('--no-report', 'Skip automatic report generation after grading')
  .option(
    '--judge-model <spec>',
    'Judge model as "provider:model" (providers: anthropic, openai; e.g. ' +
      '"openai:gpt-4o", "anthropic:claude-opus-4-7"). A bare model name ' +
      'defaults to anthropic. The grader can differ from the run model for ' +
      'independence. Overrides eval.config.json grading.judgeModel. ' +
      `Default: ${DEFAULT_JUDGE_SPEC}.`,
  )
  .option(
    '--no-judge',
    'Run programmatic checks only during auto-grading (skip LLM judge)',
  )
  .option(
    '--email <email>',
    `HyperDX account email for post-run inspection (default: ${DEFAULT_EVAL_EMAIL})`,
    DEFAULT_EVAL_EMAIL,
  )
  .option(
    '--password <pw>',
    `HyperDX account password for post-run inspection (default: ${DEFAULT_EVAL_PASSWORD})`,
    DEFAULT_EVAL_PASSWORD,
  )
  .action(
    async (
      scenarioName: string,
      cmdOpts: {
        mcp: string;
        plugin?: string;
        baseline?: string;
        runs: string;
        model: string;
        maxTurns?: string;
        seed: string;
        timeout: string;
        reseed?: true;
        anchorTime?: string;
        live?: true;
        concurrency: string;
        promptVariant: string;
        grade: boolean;
        report: boolean;
        judgeModel?: string;
        judge: boolean;
        email: string;
        password: string;
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

      const mcpKinds: McpKind[] = parseMcpFlag(cmdOpts.mcp, config);
      // Validate that all requested MCPs exist in config.
      for (const mcp of mcpKinds) {
        getMcpDefinition(config, mcp);
      }
      const models = parseModelFlag(cmdOpts.model);
      const plugins = parsePluginFlag(cmdOpts.plugin, config);
      const keyOpts = {
        multiModel: models.length > 1,
        multiPlugin: plugins.length > 1,
      };
      // Default baseline: the first listed variant of each dimension (first
      // mcp, first model, first plugin — or their defaults when a flag is
      // omitted). The auto-report persists it in _summary.json, and `report`
      // regenerations reuse the persisted value, so delta signs stay stable.
      const firstColumnKey = columnKeyFor(
        mcpKinds[0],
        models[0],
        plugins[0],
        keyOpts,
      );
      const baseline = cmdOpts.baseline ?? firstColumnKey;
      if (cmdOpts.baseline) {
        // Validate: baseline must match one of the column keys.
        const allColumnKeys = mcpKinds.flatMap(m =>
          models.flatMap(mod =>
            plugins.map(pl => columnKeyFor(m, mod, pl, keyOpts)),
          ),
        );
        if (!allColumnKeys.includes(cmdOpts.baseline)) {
          throw new Error(
            `--baseline "${cmdOpts.baseline}" is not in the column list: ${[...new Set(allColumnKeys)].join(', ')}`,
          );
        }
      }
      const promptVariant: PromptVariant = parsePromptVariant(
        cmdOpts.promptVariant,
      );
      const runs = Number(cmdOpts.runs);
      // Precedence: explicit --max-turns > scenario.maxTurns > DEFAULT_MAX_TURNS.
      const maxTurns =
        cmdOpts.maxTurns !== undefined
          ? Number(cmdOpts.maxTurns)
          : (scenario.maxTurns ?? DEFAULT_MAX_TURNS);
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

      // ── Anchor-time resolution ───────────────────────────────────
      // Default: read from config (persisted). First run auto-generates.
      // --anchor-time <iso>: override + save to config.
      // --live: ignore saved anchor, use wall-clock now (no FIXED CURRENT
      //         TIME in system prompt), and force reseed.
      //
      // The anchor is "sticky": once generated it persists in eval.config.json
      // and is reused across runs. We intentionally do NOT refresh a stale
      // anchor or force a reseed when wall-clock time advances. Previously we
      // did, solely so clickstack_describe_source's fixed 24h WALL-CLOCK
      // sampling window could still see the seeded data — but that coupled the
      // anchor to real time and forced frequent reseeds (slow in CI with
      // cached seed data). Instead, the system prompt now tells the agent that
      // describe_source's sampled value fields may be empty/stale and to
      // discover real values via anchored queries (see SAMPLING_CAVEAT_BLOCK
      // in harness/systemPrompt.ts). That removes the only reason the anchor
      // had to track wall-clock, so seeded data can age indefinitely without a
      // reseed.
      let anchorTimeIso: string | undefined;
      let anchorMs: number;
      if (cmdOpts.live) {
        if (cmdOpts.anchorTime) {
          throw new Error('--live and --anchor-time are mutually exclusive.');
        }
        anchorMs = Date.now();
        anchorTimeIso = undefined; // no anchor injection when running live
      } else {
        if (cmdOpts.anchorTime) {
          const parsed = Date.parse(cmdOpts.anchorTime);
          if (!Number.isFinite(parsed)) {
            throw new Error(
              `--anchor-time must be a valid ISO timestamp, got: ${cmdOpts.anchorTime}`,
            );
          }
        }
        const anchor = ensureAnchorTime(config, cmdOpts.anchorTime);
        anchorTimeIso = anchor.anchorTimeIso;
        anchorMs = anchor.anchorMs;
      }

      // ── Re-seed ───────────────────────────────────────────────────
      // Default: skip reseed IF data already exists. Auto-seeds on first
      // run when scenario tables are empty or missing.
      // --reseed: force re-seed even if data exists.
      // --live: always reseed (data must match wall-clock now).
      const forceReseed = cmdOpts.reseed === true || cmdOpts.live === true;
      let shouldReseed = forceReseed;
      if (!forceReseed) {
        const checkClient = buildClientFromConfig(config, opts);
        try {
          const seeded = await scenarioIsSeeded(checkClient, scenario.name);
          if (!seeded) {
            console.log(`No data found for ${scenario.name} — auto-seeding...`);
            shouldReseed = true;
          }
        } finally {
          await checkClient.close();
        }
      }
      if (shouldReseed) {
        console.log(
          `Seeding ${scenario.name} (seed=${seedNum}, now=${new Date(anchorMs).toISOString()})...`,
        );
        const seedStart = Date.now();
        const client = buildClientFromConfig(config, opts);
        try {
          const r = await seedScenario({
            client,
            scenarioName: scenario.name,
            seed: seedNum,
            nowMs: anchorMs,
            onProgress: logSeedProgress('  ', seedStart),
          });
          const seedSecs = ((Date.now() - seedStart) / 1000).toFixed(1);
          process.stdout.write('\n');
          const metricTotal = getTotalMetrics(r.metricsInserted);
          const metricsPart =
            metricTotal > 0 ? `, ${formatCount(metricTotal)} metrics` : '';
          console.log(
            `Seeded ${scenario.name}: ${formatCount(r.tracesInserted)} traces, ${formatCount(r.logsInserted)} logs${metricsPart} in ${seedSecs}s`,
          );
        } finally {
          await client.close();
        }
      }

      const batchDir = batchDirName();
      console.log(`\nBatch: runs/${batchDir}`);
      console.log(`Scenario: ${scenario.name}`);
      console.log(`MCPs: ${mcpKinds.join(', ')}`);
      console.log(`Models: ${models.join(', ')}`);
      console.log(`Plugins: ${plugins.join(', ')}`);
      console.log(
        `Runs/cell: ${runs}, max-turns: ${maxTurns}, concurrency: ${concurrency}, prompt-variant: ${promptVariant}\n`,
      );

      type SummaryRow = {
        mcp: McpKind;
        model: string;
        plugin: string;
        i: number;
        toolCalls: number;
        inputTokens: number;
        outputTokens: number;
        durationS: number;
        termination: string;
        path: string;
      };

      // Flatten the (mcp, model, plugin, runIndex) matrix into a single queue
      // and pull from it with a worker pool of size `concurrency`.
      const cells: Array<{
        mcp: McpKind;
        model: string;
        plugin: string;
        i: number;
      }> = [];
      for (const mcp of mcpKinds) {
        for (const model of models) {
          for (const plugin of plugins) {
            for (let i = 0; i < runs; i++)
              cells.push({ mcp, model, plugin, i });
          }
        }
      }

      const summary: SummaryRow[] = [];
      let cursor = 0;
      const errors: Array<{
        mcp: string;
        model: string;
        plugin: string;
        i: number;
        error: string;
      }> = [];
      async function worker(workerId: number): Promise<void> {
        while (true) {
          const idx = cursor++;
          if (idx >= cells.length) return;
          const { mcp, model, plugin, i } = cells[idx];
          const cellLabel = columnKeyFor(mcp, model, plugin, keyOpts);
          const label = concurrency > 1 ? `[w${workerId}] ` : '  ';
          try {
            process.stdout.write(
              `${label}${cellLabel} run ${i + 1}/${runs}... starting\n`,
            );
            const startedMs = Date.now();
            const record = await runCell({
              config,
              scenario,
              agentPrompt: scenario.agentPrompt,
              mcp,
              model,
              plugin,
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
              `${label}${cellLabel} run ${i + 1}/${runs}: ${record.termination} · ${record.toolCalls.length} tool calls · ${record.tokens.input}+${record.tokens.output} tok · ${seconds}s`,
            );
            summary.push({
              mcp,
              model,
              plugin,
              i,
              toolCalls: record.toolCalls.length,
              inputTokens: record.tokens.input,
              outputTokens: record.tokens.output,
              durationS: Math.round((Date.now() - startedMs) / 100) / 10,
              termination: record.termination,
              path,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(
              `${label}${cellLabel} run ${i + 1}/${runs}: FAILED — ${msg}`,
            );
            errors.push({ mcp, model, plugin, i, error: msg });
          }
        }
      }
      const workerCount = Math.min(concurrency, cells.length);
      await Promise.all(
        Array.from({ length: workerCount }, (_, w) => worker(w + 1)),
      );

      if (errors.length > 0) {
        console.error(
          `\n${errors.length} run(s) failed:\n` +
            errors
              .map(e => {
                const cl = columnKeyFor(e.mcp, e.model, e.plugin, keyOpts);
                return `  ${cl} #${e.i}: ${e.error}`;
              })
              .join('\n'),
        );
      }
      console.log('\nResults written under runs/' + batchDir);
      // Sort by (mcp, model, plugin, i) for stable summary output.
      summary.sort(
        (a, b) =>
          a.mcp.localeCompare(b.mcp) ||
          a.model.localeCompare(b.model) ||
          a.plugin.localeCompare(b.plugin) ||
          a.i - b.i,
      );
      const labelWidth = keyOpts.multiModel || keyOpts.multiPlugin ? 34 : 10;
      for (const row of summary) {
        const cl = columnKeyFor(row.mcp, row.model, row.plugin, keyOpts);
        console.log(
          `  ${cl.padEnd(labelWidth)} #${row.i}  ${row.termination.padEnd(13)}  tools=${row.toolCalls}  tokens=${row.inputTokens}+${row.outputTokens}  ${row.durationS}s`,
        );
      }

      // ─── Auto-grade ──────────────────────────────────────────────
      if (cmdOpts.grade !== false) {
        console.log('\n--- Auto-grading ---');
        // Build blinding entries from the MCPs we ran against.
        const blindingEntries = buildBlindingEntries(
          mcpKinds.map(k => ({
            kind: k,
            def: getMcpDefinition(config, k),
          })),
        );
        // Build inspection config when the scenario has a postRunInspection
        // hook and the HyperDX API config is available.
        const inspectionConfig = scenario.postRunInspection
          ? buildInspectionConfig(config, cmdOpts, anchorTimeIso)
          : undefined;
        const gradeOpts: GradeBatchOptions = {
          judgeModel: resolveJudgeModelSpec(cmdOpts.judgeModel),
          skipJudge: cmdOpts.judge === false,
          blindingEntries,
          inspectionConfig,
        };
        const gradeResult = await gradeBatch(batchDir, gradeOpts);
        console.log(
          `\nGraded ${gradeResult.graded.length} run${gradeResult.graded.length === 1 ? '' : 's'}; ${gradeResult.errors.length} error${gradeResult.errors.length === 1 ? '' : 's'}.`,
        );
        if (gradeResult.errors.length > 0) {
          for (const e of gradeResult.errors)
            console.log('  -', e.runPath, e.error);
        }

        // ─── Auto-report ────────────────────────────────────────────
        if (cmdOpts.report !== false && gradeResult.graded.length > 0) {
          console.log('\n--- Auto-report ---');
          const resolvedDir = resolveBatchDir(batchDir);
          const outPath = `${resolvedDir}/_summary.md`;
          const reportResult = writeBatchSummary(
            resolvedDir,
            outPath,
            baseline,
          );
          console.log(`Wrote ${reportResult.mdPath}`);
          console.log(`Wrote ${reportResult.jsonPath}`);
          console.log(
            `Aggregated ${reportResult.pairsCount} run${reportResult.pairsCount === 1 ? '' : 's'}.`,
          );
        }
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
          // Generic tool display — detect query-like tools by input shape.
          if (typeof inp?.query === 'string') {
            summary = `query=${String(inp.query).replace(/\s+/g, ' ').trim()}`;
          } else if (typeof inp?.sql === 'string') {
            summary = `[sql] ${String(inp.sql).replace(/\s+/g, ' ').trim()}`;
          } else if (inp?.displayType) {
            summary = `[${inp.displayType ?? '?'}] where=${inp?.where ?? '—'}  groupBy=${inp?.groupBy ?? '—'}  select=${JSON.stringify(inp?.select ?? null)}`;
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
    'Grade trajectories: programmatic checks + LLM-as-judge. The judge can ' +
      'use a different provider/model than the run model for independence ' +
      `(default: ${DEFAULT_JUDGE_SPEC}).`,
  )
  .option(
    '--judge-model <spec>',
    'Judge model as "provider:model" (providers: anthropic, openai; e.g. ' +
      '"openai:gpt-4o"). A bare model name defaults to anthropic. Overrides ' +
      'eval.config.json grading.judgeModel. ' +
      `Default: ${DEFAULT_JUDGE_SPEC}.`,
  )
  .option('--rerun-judge', 'Re-call judge even if a grade JSON already exists')
  .option('--no-judge', 'Run programmatic checks only (cheap regrade)')
  .option(
    '--email <email>',
    'HyperDX account email for post-run inspection',
    DEFAULT_EVAL_EMAIL,
  )
  .option(
    '--password <pw>',
    'HyperDX account password for post-run inspection',
    DEFAULT_EVAL_PASSWORD,
  )
  .action(
    async (
      batch: string,
      cmdOpts: {
        judgeModel?: string;
        rerunJudge?: boolean;
        judge: boolean;
        email: string;
        password: string;
      },
    ) => {
      const dir = resolveBatchDir(batch);
      console.log(`Grading batch at ${dir}`);
      // Build blinding entries from config if available.
      let blindingEntries;
      if (configExists()) {
        try {
          const cfg = readConfig();
          blindingEntries = buildBlindingEntries(
            configMcpNames(cfg).map(k => ({
              kind: k,
              def: getMcpDefinition(cfg, k),
            })),
          );
        } catch {
          // Config may be stale — grade without blinding.
        }
      }
      // Build inspection config from eval config if available.
      let inspectionConfig;
      if (configExists()) {
        try {
          const cfg = readConfig();
          inspectionConfig = buildInspectionConfig(
            cfg,
            cmdOpts,
            cfg.anchorTime,
          );
        } catch {
          // Config may be stale — grade without inspection.
        }
      }
      const summary = await gradeBatch(dir, {
        judgeModel: resolveJudgeModelSpec(cmdOpts.judgeModel),
        rerunJudge: cmdOpts.rerunJudge ?? false,
        skipJudge: cmdOpts.judge === false,
        blindingEntries,
        inspectionConfig,
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
      if (cfg.clickhouse) {
        chUrl = `http://${cfg.clickhouse.host}:${cfg.clickhouse.port}`;
        chUser = chUser ?? cfg.clickhouse.user;
        chPassword = chPassword ?? cfg.clickhouse.password;
      }
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
  .option(
    '--baseline <name>',
    'Column key to use as baseline for delta computation (default: the ' +
      "baseline recorded in the batch's _summary.json, else the first column)",
  )
  .action(
    async (batch: string, cmdOpts: { out?: string; baseline?: string }) => {
      const dir = resolveBatchDir(batch);
      const out = resolve(cmdOpts.out ?? `${dir}/_summary.md`);
      const result = writeBatchSummary(dir, out, cmdOpts.baseline);
      console.log(`Wrote ${result.mdPath}`);
      console.log(`Wrote ${result.jsonPath}`);
      console.log(
        `Aggregated ${result.pairsCount} run${result.pairsCount === 1 ? '' : 's'}.`,
      );
    },
  );

function parseMcpFlag(
  v: string,
  config: import('./hyperdx/config').EvalConfig,
): McpKind[] {
  // "all" returns only enabled MCPs (where enabled !== false).
  if (v === 'all') {
    const enabled = enabledMcpNames(config);
    if (enabled.length === 0) {
      throw new Error(
        'No enabled MCPs in config. Set "enabled": true on at least one MCP, ' +
          'or name MCPs explicitly with --mcp.',
      );
    }
    return enabled;
  }
  // Explicit names bypass the enabled flag — you can run a disabled MCP
  // by naming it directly.
  const names = v
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (names.length === 0) {
    throw new Error(
      `--mcp must be comma-separated MCP names or "all", got: ${v}`,
    );
  }
  const available = configMcpNames(config);
  for (const name of names) {
    if (!available.includes(name)) {
      throw new Error(
        `--mcp: "${name}" not found in config. Available: ${available.join(', ')}`,
      );
    }
  }
  return names;
}

function parseModelFlag(v: string): string[] {
  const models = [
    ...new Set(
      v
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    ),
  ];
  if (models.length === 0) {
    throw new Error(`--model must be a comma-separated list of model IDs`);
  }
  return models;
}

function parsePromptVariant(v: string): PromptVariant {
  if (v === 'baseline' || v === 'hypothesis') return v;
  throw new Error(
    `--prompt-variant must be "baseline" or "hypothesis", got: ${v}`,
  );
}

/**
 * Resolve the plugin variants for a run. Mirrors `--model`/`--mcp`: the plugins are
 * exactly the names passed (deduped, order-preserving). When `--plugin` is
 * omitted the default is the single no-plugin arm (`PLUGIN_NONE`).
 */
function parsePluginFlag(v: string | undefined, config: EvalConfig): string[] {
  if (!v) return [PLUGIN_NONE];
  const names = [
    ...new Set(
      v
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    ),
  ];
  if (names.length === 0) return [PLUGIN_NONE];
  const available = configPluginNames(config);
  const arms: string[] = [];
  for (const name of names) {
    if (name === PLUGIN_NONE) {
      arms.push(PLUGIN_NONE);
      continue;
    }
    if (!available.includes(name)) {
      throw new Error(
        `--plugin: "${name}" not found in config 'plugins'. Available: ${
          available.join(', ') || '(none defined)'
        }`,
      );
    }
    // Validate the definition (exactly one of url/dir) up front.
    getPluginDefinition(config, name);
    arms.push(name);
  }
  return arms;
}

program.parseAsync(process.argv).catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
