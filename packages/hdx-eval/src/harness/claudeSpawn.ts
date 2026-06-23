import { spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { EvalConfig } from '@/hyperdx/config';

import { allowedToolsPattern, buildMcpConfig } from './mcpConfig';
import { buildSettings, deniedToolsFor } from './settingsFile';
import {
  chunkToLines,
  type ParsedEvent,
  parseStreamLine,
} from './streamParser';
import type { McpDefinition, McpKind, PromptVariant } from './types';

export type SpawnOptions = {
  config: EvalConfig;
  scenario: string;
  mcp: McpKind;
  /** The resolved MCP definition from the config. */
  mcpDef: McpDefinition;
  model: string;
  maxTurns: number;
  timeoutMs: number;
  agentPrompt: string;
  systemPromptAppend: string;
  apiKey: string;
  /** Prompt variant — affects which built-in tools are denied. The
   *  `hypothesis` variant allows the Task tool so the agent can spawn
   *  subagents. Default 'baseline'. */
  promptVariant?: PromptVariant;
};

export type SpawnResult = {
  events: ParsedEvent[];
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  argv: string[];
  tempdir: string;
};

export async function runClaude(opts: SpawnOptions): Promise<SpawnResult> {
  const tempdir = mkdtempSync(join(tmpdir(), 'hdx-eval-'));
  const mcpConfigPath = join(tempdir, 'mcp-config.json');
  const settingsPath = join(tempdir, 'settings.json');

  const mcpDef = opts.mcpDef;
  writeFileSync(
    mcpConfigPath,
    JSON.stringify(buildMcpConfig(mcpDef, opts.mcp), null, 2),
  );
  const promptVariant: PromptVariant = opts.promptVariant ?? 'baseline';
  writeFileSync(
    settingsPath,
    JSON.stringify(buildSettings(mcpDef, promptVariant, tempdir), null, 2),
  );

  const argv = [
    '-p',
    '--mcp-config',
    mcpConfigPath,
    '--allowedTools',
    `${allowedToolsPattern(mcpDef)},Read(${tempdir}/*)`,
    '--disallowedTools',
    deniedToolsFor(promptVariant, mcpDef).join(','),
    '--dangerously-skip-permissions',
    '--setting-sources',
    'local',
    '--settings',
    settingsPath,
    '--append-system-prompt',
    opts.systemPromptAppend,
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    opts.model,
    '--max-turns',
    String(opts.maxTurns),
    opts.agentPrompt,
  ];

  // Run claude with cwd=tempdir (a fresh isolated dir). The agent can't
  // Bash/Read/Glob into the repo to peek at ground-truth, prior eval runs,
  // or the eval config — the only state visible is the mcp-config + settings
  // files we just wrote here.
  //
  // detached: true gives claude its own process group so we can kill the
  // entire tree (claude + MCP servers it spawns) on SIGKILL escalation.
  // SIGTERM is still sent to claude only — it handles graceful shutdown of
  // its children. The SIGKILL escalation uses process.kill(-pid) to reap
  // any orphaned MCP server processes that survived SIGTERM.
  const proc = spawn('claude', argv, {
    env: { ...process.env, ANTHROPIC_API_KEY: opts.apiKey },
    cwd: tempdir,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  const events: ParsedEvent[] = [];
  let stdoutBuffer = '';
  let stderr = '';
  let timedOut = false;

  const stdoutDone = new Promise<void>(resolve => {
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => {
      const { events: lines, remainder } = chunkToLines(stdoutBuffer, chunk);
      stdoutBuffer = remainder;
      for (const line of lines) {
        const parsed = parseStreamLine(line);
        if (parsed) events.push(parsed);
      }
    });
    proc.stdout.on('end', () => {
      if (stdoutBuffer.trim()) {
        const parsed = parseStreamLine(stdoutBuffer);
        if (parsed) events.push(parsed);
      }
      resolve();
    });
  });

  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  let escalationTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill('SIGTERM');
    } catch {
      // Process may not have started (ENOENT) — ignore.
    }
    escalationTimer = setTimeout(() => {
      try {
        // Kill the entire process group (-pid) to reap any orphaned MCP
        // server children that didn't exit after SIGTERM.
        if (proc.pid) process.kill(-proc.pid, 'SIGKILL');
      } catch {
        // Process group already exited — ignore.
      }
    }, 5_000);
    escalationTimer.unref();
  }, opts.timeoutMs);

  try {
    const exitInfo = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      proc.on('error', err => {
        clearTimeout(timeout);
        if (escalationTimer) clearTimeout(escalationTimer);
        reject(err);
      });
      proc.on('exit', (code, signal) => resolve({ code, signal }));
    });
    clearTimeout(timeout);
    if (escalationTimer) clearTimeout(escalationTimer);
    await stdoutDone;

    return {
      events,
      stderr,
      exitCode: exitInfo.code,
      signal: exitInfo.signal,
      timedOut,
      argv,
      tempdir,
    };
  } finally {
    // Clean up the temp directory to avoid leaking MCP configs with API keys.
    // This runs even if spawn() rejects (e.g. ENOENT when claude is not on PATH).
    try {
      rmSync(tempdir, { recursive: true, force: true });
    } catch {
      // Best effort — don't fail the run if cleanup fails.
    }
  }
}
