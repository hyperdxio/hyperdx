#!/usr/bin/env node

// MUST be the first import — silences console.debug/warn/error before
// any common-utils code runs. ESM hoists imports above inline code,
// so this can't be done with inline statements.
import { _origError } from '@/utils/silenceLogs';

import React, { useState, useCallback } from 'react';
import { render, Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { Command } from 'commander';
import chalk from 'chalk';

import App from '@/App';
import { ApiClient } from '@/api/client';
import { clearSession, loadSession } from '@/utils/config';
import { uploadSourcemaps } from '@/sourcemaps';

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

// ---- Interactive mode (default) ------------------------------------

program
  .command('tui')
  .description('Interactive TUI for event search and tail')
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
  .description(
    'List data sources (log, trace, session, metric) with ClickHouse table schemas',
  )
  .option('-s, --server <url>', 'HyperDX API server URL')
  .option('--json', 'Output as JSON (for programmatic consumption)')
  .addHelpText(
    'after',
    `
About:
  A "source" in HyperDX is a named data source backed by a ClickHouse table.
  Each source has a kind (log, trace, session, or metric) and a set of
  expression mappings that tell HyperDX which columns hold timestamps, trace
  IDs, span names, severity levels, etc.

  This command lists all sources and fetches the ClickHouse CREATE TABLE
  schema for each (metric sources are skipped since their schema is not
  useful for direct queries).

  Use --json for structured output suitable for LLM / agent consumption.

JSON output schema (--json):
  Array of objects, each with:
    id                  - Source ID (use with other hdx commands)
    name                - Human-readable source name
    kind                - "log" | "trace" | "session" | "metric"
    database            - ClickHouse database name
    table               - ClickHouse table name
    connection          - Connection ID for the ClickHouse proxy
    schema              - Full CREATE TABLE DDL (null for metric sources)
    expressions         - Column expression mappings:
        timestamp             - Primary timestamp column (e.g. "TimestampTime")
        displayedTimestamp    - High-precision display timestamp (DateTime64)
        body                  - Log body column
        severityText          - Severity level column (e.g. "SeverityText")
        serviceName           - Service name column
        traceId               - Trace ID column
        spanId                - Span ID column
        parentSpanId          - Parent span ID column
        spanName              - Span name column
        duration              - Duration column (raw value)
        durationPrecision     - Duration unit: 3=ms, 6=μs, 9=ns
        statusCode            - Status code column
        eventAttributes       - Span/log attributes (Map/JSON column)
        resourceAttributes    - Resource attributes (Map/JSON column)
        implicitColumn        - Implicit column for Lucene search
        defaultTableSelect    - Default SELECT clause for table view
        orderBy               - Default ORDER BY clause
    correlatedSources   - IDs of linked sources:
        log                   - Correlated log source ID
        trace                 - Correlated trace source ID
        metric                - Correlated metric source ID
        session               - Correlated session source ID

Examples:
  $ hdx sources                     # Human-readable table with schemas
  $ hdx sources --json              # JSON for agents / scripts
  $ hdx sources --json | jq '.[0]'  # Inspect first source
`,
  )
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
      if (opts.json) {
        process.stdout.write('[]\n');
      } else {
        process.stdout.write('No sources found.\n');
      }
      return;
    }

    const chClient = client.createClickHouseClient();

    // Fetch schemas for non-metric sources (in parallel)
    const schemaEntries = await Promise.all(
      sources.map(async (s): Promise<[string, string | null]> => {
        if (s.kind === 'metric') return [s.id, null];
        try {
          const resultSet = await chClient.query({
            query: `SHOW CREATE TABLE ${s.from.databaseName}.${s.from.tableName}`,
            format: 'JSON',
            connectionId: s.connection,
          });
          const json = await resultSet.json<{ statement: string }>();
          const row = (json.data as { statement: string }[])?.[0];
          return [s.id, row?.statement?.trimEnd() ?? null];
        } catch {
          return [s.id, null];
        }
      }),
    );
    const schemas = new Map(schemaEntries);

    if (opts.json) {
      const output = sources.map(s => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        database: s.from.databaseName,
        table: s.from.tableName,
        connection: s.connection,
        schema: schemas.get(s.id) ?? null,
        expressions: {
          timestamp: s.timestampValueExpression ?? null,
          displayedTimestamp: s.displayedTimestampValueExpression ?? null,
          body: s.bodyExpression ?? null,
          severityText: s.severityTextExpression ?? null,
          serviceName: s.serviceNameExpression ?? null,
          traceId: s.traceIdExpression ?? null,
          spanId: s.spanIdExpression ?? null,
          parentSpanId: s.parentSpanIdExpression ?? null,
          spanName: s.spanNameExpression ?? null,
          duration: s.durationExpression ?? null,
          durationPrecision: s.durationPrecision ?? null,
          statusCode: s.statusCodeExpression ?? null,
          eventAttributes: s.eventAttributesExpression ?? null,
          resourceAttributes: s.resourceAttributesExpression ?? null,
          implicitColumn: s.implicitColumnExpression ?? null,
          defaultTableSelect: s.defaultTableSelectExpression ?? null,
          orderBy: s.orderByExpression ?? null,
        },
        correlatedSources: {
          log: s.logSourceId ?? null,
          trace: s.traceSourceId ?? null,
          metric: s.metricSourceId ?? null,
          session: s.sessionSourceId ?? null,
        },
      }));
      process.stdout.write(JSON.stringify(output, null, 2) + '\n');
      return;
    }

    // Human-readable output
    for (const s of sources) {
      const table = `${s.from.databaseName}.${s.from.tableName}`;

      process.stdout.write(
        `${chalk.bold.cyan(s.name)}  ${chalk.dim(s.kind)}  ${chalk.dim(table)}\n`,
      );

      const schema = schemas.get(s.id);
      if (schema) {
        const lines = schema.split('\n');
        for (const line of lines) {
          process.stdout.write(chalk.dim(`  ${line}\n`));
        }
      } else if (s.kind !== 'metric') {
        process.stdout.write(chalk.dim('  (schema unavailable)\n'));
      }

      process.stdout.write('\n');
    }
  });

// ---- Dashboards ----------------------------------------------------

program
  .command('dashboards')
  .description('List dashboards with tile summaries')
  .option('-s, --server <url>', 'HyperDX API server URL')
  .option('--json', 'Output as JSON (for programmatic consumption)')
  .addHelpText(
    'after',
    `
About:
  Lists all dashboards for the authenticated team. Each dashboard
  contains tiles (charts/visualizations) that query ClickHouse sources.

  Use --json for structured output suitable for LLM / agent consumption.

JSON output schema (--json):
  Array of objects, each with:
    id                  - Dashboard ID
    name                - Dashboard name
    tags                - Array of tag strings
    filters             - Dashboard-level filter keys (key, displayName, sourceId)
    savedQuery          - Default dashboard query (if set)
    createdAt           - ISO timestamp
    updatedAt           - ISO timestamp
    tiles               - Array of tile summaries:
        id              - Tile ID
        name            - Chart name (may be null)
        type            - Chart type (time, table, number, pie, bar, etc.)
        source          - Source ID referenced by this tile (null for raw SQL)
        sql             - Raw SQL query (null for builder-mode charts)

Examples:
  $ hdx dashboards                     # Human-readable list with tiles
  $ hdx dashboards --json              # JSON for agents / scripts
  $ hdx dashboards --json | jq '.[0].tiles'  # List tiles of first dashboard
`,
  )
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

    const dashboards = await client.getDashboards();
    if (dashboards.length === 0) {
      if (opts.json) {
        process.stdout.write('[]\n');
      } else {
        process.stdout.write('No dashboards found.\n');
      }
      return;
    }

    if (opts.json) {
      const output = dashboards.map(d => ({
        id: d.id,
        name: d.name,
        tags: d.tags ?? [],
        filters: d.filters ?? [],
        savedQuery: d.savedQuery ?? null,
        createdAt: d.createdAt ?? null,
        updatedAt: d.updatedAt ?? null,
        tiles: d.tiles.map(t => ({
          id: t.id,
          name: t.config.name ?? null,
          type: t.config.type ?? t.config.displayType ?? null,
          source: t.config.source ?? null,
          sql: t.config.sql ?? null,
        })),
      }));
      process.stdout.write(JSON.stringify(output, null, 2) + '\n');
      return;
    }

    // Fetch sources to resolve source names for display
    let sourceNames: Record<string, string> = {};
    try {
      const sources = await client.getSources();
      sourceNames = Object.fromEntries(
        sources.flatMap(s => [
          [s.id, s.name],
          [s._id, s.name],
        ]),
      );
    } catch {
      // Non-fatal — just won't show source names
    }

    // Human-readable output
    for (const d of dashboards) {
      const tags =
        d.tags.length > 0 ? `  ${chalk.dim(`[${d.tags.join(', ')}]`)}` : '';
      process.stdout.write(
        `${chalk.bold.cyan(d.name)}${tags}  ${chalk.dim(`${d.tiles.length} tile${d.tiles.length !== 1 ? 's' : ''}`)}\n`,
      );

      for (let i = 0; i < d.tiles.length; i++) {
        const t = d.tiles[i];
        const isLast = i === d.tiles.length - 1;
        const prefix = isLast ? '  └─ ' : '  ├─ ';
        const name = t.config.name || '(untitled)';
        const chartType = t.config.type ?? t.config.displayType ?? 'chart';
        let sourceLabel = '';
        if (t.config.sql) {
          sourceLabel = 'raw SQL';
        } else if (t.config.source) {
          sourceLabel = `source: ${sourceNames[t.config.source] ?? t.config.source}`;
        }
        const meta = [chartType, sourceLabel].filter(Boolean).join(', ');
        process.stdout.write(
          `${chalk.dim(prefix)}${name} ${chalk.dim(`(${meta})`)}\n`,
        );
      }

      process.stdout.write('\n');
    }
  });

// ---- Query ---------------------------------------------------------

program
  .command('query')
  .description('Run a raw SQL query against a ClickHouse source')
  .requiredOption('--source <nameOrId>', 'Source name or ID')
  .requiredOption('--sql <query>', 'SQL query to execute')
  .option('-s, --server <url>', 'HyperDX API server URL')
  .option('--format <format>', 'ClickHouse output format', 'JSON')
  .addHelpText(
    'after',
    `
About:
  Execute a raw ClickHouse SQL query through the HyperDX proxy, using
  the connection credentials associated with a source. This is useful
  for ad-hoc exploration, debugging, and agent-driven queries.

  The --source flag accepts either the source name (case-insensitive)
  or the source ID (from 'hdx sources --json').

  The query is sent as-is to ClickHouse — you are responsible for
  writing valid SQL. Use 'hdx sources' to discover table names and
  column schemas.

  Output is written to stdout. Use --format to control the ClickHouse
  response format (JSON, JSONEachRow, TabSeparated, CSV, etc.).

Examples:
  $ hdx query --source "Logs" --sql "SELECT count() FROM default.otel_logs"
  $ hdx query --source "Traces" --sql "SELECT * FROM default.otel_traces LIMIT 5"
  $ hdx query --source "Logs" --sql "SELECT Body FROM default.otel_logs LIMIT 3" --format JSONEachRow
`,
  )
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
    const source = sources.find(
      s =>
        s.name.toLowerCase() === opts.source.toLowerCase() ||
        s.id === opts.source ||
        s._id === opts.source,
    );

    if (!source) {
      _origError(chalk.red(`Source "${opts.source}" not found.\n`));
      _origError('Available sources:');
      for (const s of sources) {
        _origError(`  - ${s.name} (${s.kind}) [${s.id}]`);
      }
      process.exit(1);
    }

    const chClient = client.createClickHouseClient();

    try {
      const resultSet = await chClient.query({
        query: opts.sql,
        format: opts.format,
        connectionId: source.connection,
      });
      const text = await resultSet.text();
      process.stdout.write(text);
      // Ensure trailing newline for clean terminal output
      if (text.length > 0 && !text.endsWith('\n')) {
        process.stdout.write('\n');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      _origError(chalk.red(`Query failed: ${msg}\n`));
      process.exit(1);
    }
  });

// ---- Upload Sourcemaps ---------------------------------------------

program
  .command('upload-sourcemaps')
  .description(
    'Upload JavaScript source maps to HyperDX for stack trace de-obfuscation',
  )
  .option('-k, --serviceKey <string>', 'The HyperDX service account API key')
  .option(
    '-u, --apiUrl [string]',
    'An optional api url for self-hosted deployments',
  )
  .option(
    '-rid, --releaseId [string]',
    'An optional release id to associate the sourcemaps with',
  )
  .option(
    '-p, --path [string]',
    'Sets the directory of where the sourcemaps are',
    '.',
  )
  .option(
    '-bp, --basePath [string]',
    'An optional base path for the uploaded sourcemaps',
  )
  .option('--apiVersion [string]', 'The API version to use (v1 or v2)', 'v1')
  .action(uploadSourcemaps);

program.parse();
