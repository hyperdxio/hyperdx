#!/usr/bin/env node

// MUST be the first import — silences console.debug/warn/error before
// any common-utils code runs. ESM hoists imports above inline code,
// so this can't be done with inline statements.
import {
  _origError,
  enableVerboseFileLogging,
  DEBUG_LOG_PATH,
} from '@/utils/silenceLogs';

import React, { useState, useCallback } from 'react';
import { render, Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { Command } from 'commander';
import chalk from 'chalk';

import App from '@/App';
import { ApiClient } from '@/api/client';
import { buildEventSearchQuery } from '@/api/eventQuery';
import { clearSession, loadSession } from '@/utils/config';

// ---- Standalone interactive login for `hdx auth login` -------------

function LoginPrompt({
  apiUrl,
  client,
}: {
  apiUrl: string;
  client: ApiClient;
}) {
  const { exit } = useApp();
  const [field, setField] = useState<'email' | 'password'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmitEmail = useCallback(() => {
    if (!email.trim()) return;
    setField('password');
  }, [email]);

  const handleSubmitPassword = useCallback(async () => {
    if (!password) return;
    setLoading(true);
    setError(null);
    const ok = await client.login(email, password);
    setLoading(false);
    if (ok) {
      exit();
      // Small delay to let Ink unmount before writing to stdout
      setTimeout(() => {
        process.stdout.write(
          chalk.green(`\nLogged in as ${email} (${apiUrl})\n`),
        );
      }, 50);
    } else {
      setError('Login failed. Check your email and password.');
      setField('email');
      setEmail('');
      setPassword('');
    }
  }, [email, password, client, apiUrl, exit]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        HyperDX — Login
      </Text>
      <Text dimColor>Server: {apiUrl}</Text>
      <Text> </Text>

      {error && <Text color="red">{error}</Text>}

      {loading ? (
        <Text>
          <Spinner type="dots" /> Logging in…
        </Text>
      ) : field === 'email' ? (
        <Box>
          <Text>Email: </Text>
          <TextInput
            value={email}
            onChange={setEmail}
            onSubmit={handleSubmitEmail}
          />
        </Box>
      ) : (
        <Box>
          <Text>Password: </Text>
          <TextInput
            value={password}
            onChange={setPassword}
            onSubmit={handleSubmitPassword}
            mask="*"
          />
        </Box>
      )}
    </Box>
  );
}

/**
 * Resolve the server URL: use the provided flag, or fall back to the
 * saved session's apiUrl. Exits with an error if neither is available.
 */
function resolveServer(flagValue: string | undefined): string {
  if (flagValue) return flagValue;
  const session = loadSession();
  if (session?.apiUrl) return session.apiUrl;
  _origError(
    chalk.red(
      `No server specified. Use ${chalk.bold('-s <url>')} or run ${chalk.bold('hdx auth login -s <url>')} first.\n`,
    ),
  );
  process.exit(1);
}

const program = new Command();

program
  .name('hdx')
  .description('HyperDX CLI — search and tail events from the terminal')
  .version('0.1.0')
  .enablePositionalOptions();

// Helper: enable --verbose on a command (logs to file)
function withVerbose(cmd: Command): Command {
  return cmd
    .option('--verbose', 'Enable debug/warning output')
    .hook('preAction', (thisCmd: Command) => {
      if (thisCmd.opts().verbose) {
        enableVerboseFileLogging();
        _origError(`[verbose] Debug logs → ${DEBUG_LOG_PATH}\n`);
      }
    });
}

// ---- Interactive mode (default) ------------------------------------

withVerbose(
  program
    .command('tui')
    .description('Interactive TUI for event search and tail'),
)
  .option('-s, --server <url>', 'HyperDX API server URL')
  .option('-q, --query <query>', 'Initial Lucene search query')
  .option('--source <name>', 'Source name (skips picker)')
  .option('-f, --follow', 'Start in follow/live tail mode')
  .action(opts => {
    const server = resolveServer(opts.server);
    render(
      <App
        apiUrl={server}
        query={opts.query}
        sourceName={opts.source}
        follow={opts.follow}
      />,
    );
  });

// ---- Stream mode (non-interactive, pipe-friendly) ------------------

withVerbose(
  program
    .command('stream')
    .description('Stream events to stdout (non-interactive, pipe-friendly)'),
)
  .option('-s, --server <url>', 'HyperDX API server URL')
  .requiredOption('--source <name>', 'Source name')
  .option('-q, --query <query>', 'Lucene search query', '')
  .option('-f, --follow', 'Continuously poll for new events')
  .option('-n, --limit <number>', 'Max rows per fetch', '100')
  .option(
    '--since <duration>',
    'How far back to look (e.g. 1h, 30m, 24h)',
    '1h',
  )
  .action(async opts => {
    const server = resolveServer(opts.server);
    const client = new ApiClient({ apiUrl: server });

    if (!(await client.checkSession())) {
      _origError(chalk.red('Not logged in. Run `hdx auth login` to sign in.'));
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

// ---- Auth (login / logout / status) --------------------------------

const auth = program
  .command('auth')
  .description('Manage authentication')
  .enablePositionalOptions()
  .passThroughOptions();

auth
  .command('login')
  .description('Sign in to your HyperDX account')
  .requiredOption('-s, --server <url>', 'HyperDX API server URL')
  .option('-e, --email <email>', 'Email address')
  .option('-p, --password <password>', 'Password')
  .action(async opts => {
    const client = new ApiClient({ apiUrl: opts.server });

    if (opts.email && opts.password) {
      // Non-interactive login (for scripting/CI)
      const ok = await client.login(opts.email, opts.password);
      if (ok) {
        process.stdout.write(
          chalk.green(`Logged in as ${opts.email} (${opts.server})\n`),
        );
      } else {
        _origError(chalk.red('Login failed. Check your email and password.\n'));
        process.exit(1);
      }
    } else {
      // Interactive login via Ink
      const { waitUntilExit } = render(
        <LoginPrompt apiUrl={opts.server} client={client} />,
      );
      await waitUntilExit();
    }
  });

auth
  .command('logout')
  .description('Log out from your HyperDX account')
  .action(() => {
    clearSession();
    process.stdout.write('Session cleared.\n');
  });

auth
  .command('status')
  .description('Show authentication status')
  .action(async () => {
    const session = loadSession();
    if (!session) {
      process.stdout.write(
        chalk.yellow(
          `Not logged in. Run ${chalk.bold('hdx auth login -s <url>')} to sign in.\n`,
        ),
      );
      process.exit(1);
    }

    const client = new ApiClient({ apiUrl: session.apiUrl });
    const ok = await client.checkSession();

    if (!ok) {
      process.stdout.write(
        chalk.yellow(
          `Session expired. Run ${chalk.bold('hdx auth login -s <url>')} to sign in again.\n`,
        ),
      );
      process.exit(1);
    }

    try {
      const me = await client.getMe();
      process.stdout.write(
        `${chalk.green('Logged in')} as ${chalk.bold(me.email)} (${session.apiUrl})\n`,
      );
    } catch {
      process.stdout.write(chalk.green('Logged in') + ` (${session.apiUrl})\n`);
    }
  });

// ---- Sources -------------------------------------------------------

program
  .command('sources')
  .description('List available sources')
  .option('-s, --server <url>', 'HyperDX API server URL')
  .action(async opts => {
    const server = resolveServer(opts.server);
    const client = new ApiClient({ apiUrl: server });

    if (!(await client.checkSession())) {
      _origError(
        chalk.red(
          `Not logged in. Run ${chalk.bold('hdx auth login')} to sign in.\n`,
        ),
      );
      process.exit(1);
    }

    const sources = await client.getSources();
    if (sources.length === 0) {
      process.stdout.write('No sources found.\n');
      return;
    }

    // Print as a table
    const nameWidth = Math.max(6, ...sources.map(s => s.name.length));
    const kindWidth = Math.max(5, ...sources.map(s => s.kind.length));

    process.stdout.write(
      `${chalk.bold('Name'.padEnd(nameWidth))}  ${chalk.bold('Kind'.padEnd(kindWidth))}  ${chalk.bold('Table')}\n`,
    );
    process.stdout.write(
      `${'─'.repeat(nameWidth)}  ${'─'.repeat(kindWidth)}  ${'─'.repeat(30)}\n`,
    );

    for (const s of sources) {
      const table = `${s.from.databaseName}.${s.from.tableName}`;
      process.stdout.write(
        `${s.name.padEnd(nameWidth)}  ${chalk.dim(s.kind.padEnd(kindWidth))}  ${chalk.dim(table)}\n`,
      );
    }
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
