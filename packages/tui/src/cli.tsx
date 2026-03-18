#!/usr/bin/env node

// MUST be the first import — silences console.debug/warn/error before
// any common-utils code runs. ESM hoists imports above inline code,
// so this can't be done with inline statements.
import { _origDebug, _origWarn, _origError } from '@/utils/silenceLogs';

import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import chalk from 'chalk';

import App from '@/App';
import { ApiClient } from '@/api/client';
import { buildEventSearchQuery } from '@/api/eventQuery';
import { clearSession } from '@/utils/config';

const DEFAULT_API_URL = 'http://localhost:8000';

const program = new Command();

program
  .name('hdx')
  .description('HyperDX TUI — search and tail events from the terminal')
  .version('0.1.0')
  .option('--verbose', 'Enable debug/warning output from internal libraries')
  .hook('preAction', thisCommand => {
    if (thisCommand.opts().verbose) {
      console.debug = _origDebug;
      console.warn = _origWarn;
      console.error = _origError;
    }
  });

// ---- Interactive mode (default) ------------------------------------

program
  .command('events', { isDefault: true })
  .description('Interactive event search and tail')
  .option('-s, --server <url>', 'HyperDX API server URL', DEFAULT_API_URL)
  .option('-q, --query <query>', 'Initial Lucene search query')
  .option('--source <name>', 'Source name (skips picker)')
  .option('-f, --follow', 'Start in follow/tail mode')
  .action(opts => {
    render(
      <App
        apiUrl={opts.server}
        query={opts.query}
        sourceName={opts.source}
        follow={opts.follow}
      />,
    );
  });

// ---- Stream mode (non-interactive, pipe-friendly) ------------------

program
  .command('stream')
  .description('Stream events to stdout (non-interactive, pipe-friendly)')
  .requiredOption('--source <name>', 'Source name')
  .option('-s, --server <url>', 'HyperDX API server URL', DEFAULT_API_URL)
  .option('-q, --query <query>', 'Lucene search query', '')
  .option('-f, --follow', 'Continuously poll for new events')
  .option('-n, --limit <number>', 'Max rows per fetch', '100')
  .option(
    '--since <duration>',
    'How far back to look (e.g. 1h, 30m, 24h)',
    '1h',
  )
  .action(async opts => {
    const client = new ApiClient({ apiUrl: opts.server });

    if (!(await client.checkSession())) {
      _origError(
        chalk.red(
          'Not logged in. Run `hdx events` first to authenticate interactively.',
        ),
      );
      process.exit(1);
    }

    const sources = await client.getSources();
    const source = sources.find(
      s => s.name.toLowerCase() === opts.source.toLowerCase(),
    );

    if (!source) {
      _origError(chalk.red(`Source "${opts.source}" not found.`));
      _origError('Available sources:');
      for (const s of sources) {
        _origError(`  - ${s.name} (${s.kind})`);
      }
      process.exit(1);
    }

    const chClient = client.createClickHouseClient();
    const metadata = client.createMetadata();
    const limit = parseInt(opts.limit, 10) || 100;
    const sinceMs = parseDuration(opts.since);

    const tsExpr = source.timestampValueExpression ?? 'TimestampTime';
    const bodyExpr = source.bodyExpression ?? 'Body';
    const sevExpr = source.severityTextExpression ?? 'SeverityText';

    let lastEndTime = new Date();

    const fetchAndPrint = async (startTime: Date, endTime: Date) => {
      const chSql = await buildEventSearchQuery(
        {
          source,
          searchQuery: opts.query,
          startTime,
          endTime,
          limit,
        },
        metadata,
      );

      const resultSet = await chClient.query({
        query: chSql.sql,
        query_params: chSql.params,
        format: 'JSON',
        connectionId: source.connection,
      });

      const json = await resultSet.json<Record<string, string | number>>();
      const rows = json.data ?? [];

      for (const row of rows.reverse()) {
        const ts = row[tsExpr] ?? '';
        const sev = String(row[sevExpr] ?? '');
        const body = row[bodyExpr] ?? JSON.stringify(row);

        const sevStr = sev ? colorSeverity(sev) : '';
        process.stdout.write(`${chalk.dim(String(ts))} ${sevStr}${body}\n`);
      }

      return rows.length;
    };

    // Initial fetch
    const start = new Date(lastEndTime.getTime() - sinceMs);
    await fetchAndPrint(start, lastEndTime);

    // Follow mode
    if (opts.follow) {
      const poll = async () => {
        const now = new Date();
        const since = new Date(lastEndTime.getTime() - 2000);
        await fetchAndPrint(since, now);
        lastEndTime = now;
      };

      setInterval(poll, 2000);
      await new Promise(() => {});
    }
  });

// ---- Logout --------------------------------------------------------

program
  .command('logout')
  .description('Clear saved session')
  .action(() => {
    clearSession();
    process.stdout.write('Session cleared.\n');
  });

// ---- Helpers -------------------------------------------------------

function parseDuration(s: string): number {
  const match = s.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 60 * 60 * 1000;
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case 's':
      return n * 1000;
    case 'm':
      return n * 60 * 1000;
    case 'h':
      return n * 60 * 60 * 1000;
    case 'd':
      return n * 24 * 60 * 60 * 1000;
    default:
      return 60 * 60 * 1000;
  }
}

function colorSeverity(sev: string): string {
  const s = sev.toLowerCase();
  const tag = `[${sev}] `;
  if (s === 'error' || s === 'fatal' || s === 'critical')
    return chalk.red.bold(tag);
  if (s === 'warn' || s === 'warning') return chalk.yellow.bold(tag);
  if (s === 'info') return chalk.blue(tag);
  if (s === 'debug' || s === 'trace') return chalk.gray(tag);
  return tag;
}

program.parse();
