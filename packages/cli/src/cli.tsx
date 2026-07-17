#!/usr/bin/env node

// MUST be the first import — silences console.debug/warn/error before
// any common-utils code runs. ESM hoists imports above inline code,
// so this can't be done with inline statements.
import { _origError } from '@/utils/silenceLogs';

import React, { useState, useCallback } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  TemplateMiner,
  TemplateMinerConfig,
} from '@hyperdx/common-utils/dist/drain';

import type { SavedChartConfig } from '@hyperdx/common-utils/dist/types';

import App from '@/App';
import { ApiClient, type SourceResponse, type MeTeam } from '@/api/client';
import { AdhocChartError, buildAdhocChartConfig } from '@/shared/adhocChart';
import { stripAnsi } from '@/termchart';
import { parseGranularityFlag, sortTilesForDisplay } from '@/shared/tileConfig';
import { fetchTileData } from '@/shared/tileQuery';
import { renderTileContent } from '@/shared/tileRender';
import { clearSession, loadSession, setActiveTeam } from '@/utils/config';
import { parseTimeValue } from '@/utils/editor';
import { uploadSourcemaps } from '@/sourcemaps';

// ---- Standalone interactive login for `hdx auth login` -------------

/** Returns true if the string is a valid HTTP(S) URL. */
function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Add new login methods here to extend the login flow.
const LOGIN_METHODS = [
  { id: 'password', label: 'Email / Password' },
  // { id: 'oauth', label: 'OAuth / SSO' },
] as const;

type LoginMethod = (typeof LOGIN_METHODS)[number]['id'];

function LoginPrompt({
  initialAppUrl,
  initialClient,
}: {
  initialAppUrl?: string;
  initialClient?: ApiClient;
}) {
  const { exit } = useApp();
  const [field, setField] = useState<
    'method' | 'appUrl' | 'email' | 'password'
  >('method');
  const [methodIdx, setMethodIdx] = useState(0);
  const [_method, setMethod] = useState<LoginMethod | null>(null);
  const [appUrl, setAppUrl] = useState(initialAppUrl ?? '');
  const [client, setClient] = useState<ApiClient | null>(initialClient ?? null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Arrow-key navigation for login method picker
  useInput(
    (input, key) => {
      if (field !== 'method') return;
      if (key.upArrow || input === 'k') {
        setMethodIdx(i => Math.max(0, i - 1));
      }
      if (key.downArrow || input === 'j') {
        setMethodIdx(i => Math.min(LOGIN_METHODS.length - 1, i + 1));
      }
      if (key.return) {
        const selected = LOGIN_METHODS[methodIdx];
        setMethod(selected.id);
        setField(initialAppUrl ? 'email' : 'appUrl');
      }
    },
    { isActive: field === 'method' },
  );

  const handleSubmitAppUrl = useCallback(() => {
    const trimmed = appUrl.trim();
    if (!trimmed) return;
    if (!isValidUrl(trimmed)) {
      setError('Invalid URL. Please enter a valid http:// or https:// URL.');
      return;
    }
    setError(null);
    const c = new ApiClient({ appUrl: trimmed });
    setClient(c);
    setField('email');
  }, [appUrl]);

  const handleSubmitEmail = useCallback(() => {
    if (!email.trim()) return;
    setField('password');
  }, [email]);

  const handleSubmitPassword = useCallback(async () => {
    if (!password || !client) return;
    setLoading(true);
    setError(null);
    const loginError = await client.login(email, password);
    setLoading(false);
    if (!loginError) {
      exit();
      // Small delay to let Ink unmount before writing to stdout
      setTimeout(() => {
        process.stdout.write(
          chalk.green(`\nLogged in as ${email} (${appUrl})\n`),
        );
      }, 50);
    } else {
      setError(loginError);
      setField('email');
      setEmail('');
      setPassword('');
    }
  }, [email, password, client, appUrl, exit]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        HyperDX — Login
      </Text>
      {field !== 'method' && field !== 'appUrl' && (
        <Text dimColor>Server: {appUrl}</Text>
      )}
      <Text> </Text>

      {error && <Text color="red">{error}</Text>}

      {loading ? (
        <Text>
          <Spinner type="dots" /> Logging in…
        </Text>
      ) : field === 'method' ? (
        <Box flexDirection="column">
          <Text>Login method:</Text>
          <Text> </Text>
          {LOGIN_METHODS.map((m, i) => (
            <Text key={m.id} color={i === methodIdx ? 'green' : undefined}>
              {i === methodIdx ? '▸ ' : '  '}
              {m.label}
            </Text>
          ))}
          <Text> </Text>
          <Text dimColor>↑/↓ to navigate, Enter to select</Text>
        </Box>
      ) : field === 'appUrl' ? (
        <Box>
          <Text>HyperDX URL: </Text>
          <TextInput
            value={appUrl}
            onChange={setAppUrl}
            onSubmit={handleSubmitAppUrl}
            placeholder="http://localhost:8080"
          />
        </Box>
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
 * Resolve the app URL: use the provided flag, or fall back to the
 * saved session's appUrl. Returns undefined if neither is available.
 */
function resolveServer(flagValue: string | undefined): string | undefined {
  if (flagValue) return flagValue;
  const session = loadSession();
  if (session?.appUrl) return session.appUrl;
  return undefined;
}

/**
 * Ensure the user has a valid session. If the session is expired or
 * missing, launches the interactive LoginPrompt (with the last URL
 * autofilled) and waits for re-authentication.
 *
 * Returns an authenticated ApiClient ready for use.
 */
async function ensureSession(
  flagAppUrl: string | undefined,
): Promise<ApiClient> {
  const appUrl = resolveServer(flagAppUrl);

  // If we have an appUrl, try the existing session first
  if (appUrl) {
    const client = new ApiClient({ appUrl });
    if (await client.checkSession()) {
      return client;
    }
    // Session expired — show message and re-login
    process.stderr.write(
      chalk.yellow('Session expired — launching login…\n\n'),
    );
  }

  // Launch interactive login prompt (appUrl autofilled if available)
  return new Promise<ApiClient>(resolve => {
    const { waitUntilExit } = render(
      <ReLoginPrompt defaultAppUrl={appUrl} onAuthenticated={resolve} />,
    );
    // If the user ctrl-c's out of the prompt, exit the process
    waitUntilExit().then(() => {
      // If the promise was already resolved, this is a no-op.
      // Otherwise the user quit without logging in.
    });
  });
}

/**
 * Lightweight wrapper around LoginPrompt for non-TUI commands.
 * Resolves the onAuthenticated callback with a ready ApiClient.
 */
function ReLoginPrompt({
  defaultAppUrl,
  onAuthenticated,
}: {
  defaultAppUrl?: string;
  onAuthenticated: (client: ApiClient) => void;
}) {
  const { exit } = useApp();
  const [field, setField] = useState<
    'method' | 'appUrl' | 'email' | 'password'
  >('method');
  const [methodIdx, setMethodIdx] = useState(0);
  const [_method, setMethod] = useState<LoginMethod | null>(null);
  const [appUrl, setAppUrl] = useState(defaultAppUrl ?? '');
  const [client, setClient] = useState<ApiClient | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useInput(
    (input, key) => {
      if (field !== 'method') return;
      if (key.upArrow || input === 'k') {
        setMethodIdx(i => Math.max(0, i - 1));
      }
      if (key.downArrow || input === 'j') {
        setMethodIdx(i => Math.min(LOGIN_METHODS.length - 1, i + 1));
      }
      if (key.return) {
        const selected = LOGIN_METHODS[methodIdx];
        setMethod(selected.id);
        setField('appUrl');
      }
    },
    { isActive: field === 'method' },
  );

  const handleSubmitAppUrl = useCallback(() => {
    const trimmed = appUrl.trim();
    if (!trimmed) return;
    if (!isValidUrl(trimmed)) {
      setError('Invalid URL. Please enter a valid http:// or https:// URL.');
      return;
    }
    setError(null);
    const c = new ApiClient({ appUrl: trimmed });
    setClient(c);
    setField('email');
  }, [appUrl]);

  const handleSubmitEmail = useCallback(() => {
    if (!email.trim()) return;
    setField('password');
  }, [email]);

  const handleSubmitPassword = useCallback(async () => {
    if (!password || !client) return;
    setLoading(true);
    setError(null);
    const loginError = await client.login(email, password);
    setLoading(false);
    if (!loginError) {
      exit();
      setTimeout(() => {
        process.stdout.write(
          chalk.green(`Logged in as ${email} (${appUrl})\n\n`),
        );
        onAuthenticated(client);
      }, 50);
    } else {
      setError(loginError);
      setField('email');
      setEmail('');
      setPassword('');
    }
  }, [email, password, client, appUrl, exit, onAuthenticated]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        HyperDX — Login
      </Text>
      {field !== 'method' && field !== 'appUrl' && (
        <Text dimColor>Server: {appUrl}</Text>
      )}
      <Text> </Text>

      {error && <Text color="red">{error}</Text>}

      {loading ? (
        <Text>
          <Spinner type="dots" /> Logging in…
        </Text>
      ) : field === 'method' ? (
        <Box flexDirection="column">
          <Text>Login method:</Text>
          <Text> </Text>
          {LOGIN_METHODS.map((m, i) => (
            <Text key={m.id} color={i === methodIdx ? 'green' : undefined}>
              {i === methodIdx ? '▸ ' : '  '}
              {m.label}
            </Text>
          ))}
          <Text> </Text>
          <Text dimColor>↑/↓ to navigate, Enter to select</Text>
        </Box>
      ) : field === 'appUrl' ? (
        <Box>
          <Text>HyperDX URL: </Text>
          <TextInput
            value={appUrl}
            onChange={setAppUrl}
            onSubmit={handleSubmitAppUrl}
            placeholder="http://localhost:8080"
          />
        </Box>
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

const program = new Command();

program
  .name('hdx')
  .description('HyperDX CLI — search and tail events from the terminal')
  .version(process.env.npm_package_version ?? '0.0.0')
  .enablePositionalOptions();

// ---- Interactive mode (default) ------------------------------------

program
  .command('tui')
  .description('Interactive TUI for event search and tail')
  .option('-a, --app-url <url>', 'HyperDX app URL')
  .option('-q, --query <query>', 'Initial Lucene search query')
  .option('--source <name>', 'Source name (skips picker)')
  .option('-f, --follow', 'Start in follow/live tail mode')
  .action(async opts => {
    const server = resolveServer(opts.appUrl);
    if (!server) {
      // No saved session and no -a flag — need to login first
      const client = await ensureSession(undefined);
      render(
        <App
          appUrl={client.getAppUrl()}
          query={opts.query}
          sourceName={opts.source}
          follow={opts.follow}
        />,
      );
    } else {
      render(
        <App
          appUrl={server}
          query={opts.query}
          sourceName={opts.source}
          follow={opts.follow}
        />,
      );
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
  .option('-a, --app-url <url>', 'HyperDX app URL')
  .option('-e, --email <email>', 'Email address')
  .option('-p, --password <password>', 'Password')
  .action(async opts => {
    if (opts.email && opts.password) {
      // Non-interactive login (for scripting/CI) — app URL is required
      if (!opts.appUrl) {
        _origError(
          chalk.red(
            `App URL is required for non-interactive login. Use ${chalk.bold('-a <url>')}.\n`,
          ),
        );
        process.exit(1);
      }
      const client = new ApiClient({ appUrl: opts.appUrl });
      const loginError = await client.login(opts.email, opts.password);
      if (!loginError) {
        process.stdout.write(
          chalk.green(`Logged in as ${opts.email} (${opts.appUrl})\n`),
        );
      } else {
        _origError(chalk.red(`${loginError}\n`));
        process.exit(1);
      }
    } else {
      // Interactive login via Ink — prompt for app URL if not provided
      const client = opts.appUrl
        ? new ApiClient({ appUrl: opts.appUrl })
        : undefined;
      const { waitUntilExit } = render(
        <LoginPrompt initialAppUrl={opts.appUrl} initialClient={client} />,
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
          `Not logged in. Run ${chalk.bold('hdx auth login')} to sign in.\n`,
        ),
      );
      process.exit(1);
    }

    const client = new ApiClient({ appUrl: session.appUrl });
    const ok = await client.checkSession();

    if (!ok) {
      process.stdout.write(
        chalk.yellow(
          `Session expired. Run ${chalk.bold('hdx auth login')} to sign in again.\n`,
        ),
      );
      process.exit(1);
    }

    try {
      const me = await client.getMe();
      process.stdout.write(
        `${chalk.green('Logged in')} as ${chalk.bold(me.email)} (${session.appUrl})\n`,
      );
      // Surface the active team so users always know which team's data
      // their commands are scoped to.
      const activeTeam = resolveActiveTeam(me, session.activeTeamId);
      if (activeTeam) {
        process.stdout.write(
          `Team: ${chalk.bold(activeTeam.name)} ${chalk.dim(`[${activeTeam.id}]`)}\n`,
        );
      }
    } catch {
      process.stdout.write(chalk.green('Logged in') + ` (${session.appUrl})\n`);
    }
  });

/**
 * Resolve which team is "currently active" for display purposes.
 *
 * - If `session.activeTeamId` is set and matches a team the user
 *   belongs to, return that team.
 * - Otherwise fall back to `me.team` (the server-side default).
 */
function resolveActiveTeam(
  me: { team: MeTeam; teams?: MeTeam[] },
  activeTeamId: string | undefined,
): MeTeam | null {
  const teams = me.teams && me.teams.length > 0 ? me.teams : [me.team];
  if (activeTeamId) {
    const match = teams.find(t => t.id === activeTeamId);
    if (match) return match;
  }
  return me.team ?? null;
}

// ---- Teams ---------------------------------------------------------

const team = program
  .command('team')
  .description(
    'Manage the active team (kubectx-style switching for users in multiple teams)',
  )
  .enablePositionalOptions()
  .passThroughOptions();

team
  .command('list')
  .description('List all teams the authenticated user belongs to')
  .option('-a, --app-url <url>', 'HyperDX app URL')
  .option('--json', 'Output as JSON (for programmatic consumption)')
  .addHelpText(
    'after',
    `
About:
  Lists every team the authenticated user belongs to. The team marked
  with an arrow ('▸ ') is the currently active team — all subsequent
  CLI commands query that team's data.

  Use ${chalk.bold('hdx team use <name|id>')} to switch the active team.

JSON output schema (--json):
  {
    "currentTeamId": "<id of the active team>",
    "teams": [
      { "id": "...", "name": "...", "isCurrent": true | false }
    ]
  }

Examples:
  $ hdx team list
  $ hdx team list --json | jq '.teams[] | select(.isCurrent)'
`,
  )
  .action(async opts => {
    const client = await ensureSession(opts.appUrl);
    let teams: MeTeam[];
    try {
      teams = await client.getUserTeams();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      _origError(chalk.red(`Failed to load teams: ${msg}\n`));
      process.exit(1);
    }

    const session = loadSession();
    const activeId =
      session?.activeTeamId ??
      // No saved override — show the first team as active (matches what
      // the API will scope to without an x-hdx-team header).
      teams[0]?.id;

    if (opts.json) {
      const output = {
        currentTeamId: activeId ?? null,
        teams: teams.map(t => ({
          id: t.id,
          name: t.name,
          isCurrent: t.id === activeId,
        })),
      };
      process.stdout.write(JSON.stringify(output, null, 2) + '\n');
      return;
    }

    if (teams.length === 0) {
      process.stdout.write('No teams found.\n');
      return;
    }

    for (const t of teams) {
      const isActive = t.id === activeId;
      const marker = isActive ? chalk.green('▸ ') : '  ';
      const name = isActive ? chalk.bold.cyan(t.name) : chalk.cyan(t.name);
      process.stdout.write(`${marker}${name}  ${chalk.dim(`[${t.id}]`)}\n`);
    }

    if (teams.length === 1) {
      process.stdout.write(
        chalk.dim(
          `\nYou belong to a single team. ${chalk.bold('hdx team use')} is a no-op here.\n`,
        ),
      );
    }
  });

team
  .command('current')
  .description('Show the currently active team')
  .option('-a, --app-url <url>', 'HyperDX app URL')
  .option('--json', 'Output as JSON (for programmatic consumption)')
  .action(async opts => {
    const client = await ensureSession(opts.appUrl);
    let me;
    try {
      me = await client.getMe();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      _origError(chalk.red(`Failed to load user info: ${msg}\n`));
      process.exit(1);
    }

    const session = loadSession();
    const active = resolveActiveTeam(me, session?.activeTeamId);

    if (opts.json) {
      process.stdout.write(
        JSON.stringify(
          active ? { id: active.id, name: active.name } : null,
          null,
          2,
        ) + '\n',
      );
      return;
    }

    if (!active) {
      process.stdout.write('No active team.\n');
      return;
    }
    process.stdout.write(
      `${chalk.bold.cyan(active.name)}  ${chalk.dim(`[${active.id}]`)}\n`,
    );
  });

team
  .command('use <name-or-id>')
  .description(
    'Switch the active team. <name-or-id> matches either the team ID or its display name (case-insensitive).',
  )
  .option('-a, --app-url <url>', 'HyperDX app URL')
  .addHelpText(
    'after',
    `
About:
  Sets the active team for subsequent CLI commands. The choice is
  persisted in ${chalk.bold('~/.config/hyperdx/cli/session.json')} so it
  survives across CLI invocations.

  The CLI sends the chosen team ID as an ${chalk.bold('x-hdx-team')} HTTP
  header on every API and ClickHouse-proxy request. The server validates
  membership — switching to a team the authenticated user does not
  belong to fails with an auth error on the next request.

  On single-team OSS deployments, all users belong to a single team, so
  this command is effectively a no-op (it succeeds but does not change
  any data scoping).

Examples:
  $ hdx team use my-team
  $ hdx team use 6537a1d2c8b7f4e2a1d2c8b7
`,
  )
  .action(async (nameOrId: string, opts) => {
    const client = await ensureSession(opts.appUrl);
    let teams: MeTeam[];
    try {
      teams = await client.getUserTeams();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      _origError(chalk.red(`Failed to load teams: ${msg}\n`));
      process.exit(1);
    }

    const lowered = nameOrId.toLowerCase();
    const match =
      teams.find(t => t.id === nameOrId) ??
      teams.find(t => t.name.toLowerCase() === lowered);

    if (!match) {
      _origError(chalk.red(`No team matching "${nameOrId}".\n`));
      _origError('Available teams:');
      for (const t of teams) {
        _origError(`  - ${t.name} [${t.id}]`);
      }
      process.exit(1);
    }

    setActiveTeam(match.id);
    process.stdout.write(
      `${chalk.green('Switched to')} ${chalk.bold.cyan(match.name)} ${chalk.dim(`[${match.id}]`)}\n`,
    );
  });

// ---- Sources -------------------------------------------------------

program
  .command('sources')
  .description(
    'List data sources (log, trace, session, metric) with ClickHouse table schemas',
  )
  .option('-a, --app-url <url>', 'HyperDX app URL')
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
    const client = await ensureSession(opts.appUrl);

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

// ---- Connections ---------------------------------------------------

program
  .command('connections')
  .description('List ClickHouse connections (id, name, host)')
  .option('-a, --app-url <url>', 'HyperDX app URL')
  .option('--json', 'Output as JSON (for programmatic consumption)')
  .addHelpText(
    'after',
    `
About:
  Lists ClickHouse connections configured for the authenticated team.
  Each connection is a named set of credentials that one or more
  sources point at (via the 'connection' field on a source).

  Use 'hdx sources --json' to see which connection each source uses.

JSON output schema (--json):
  Array of objects, each with:
    id    - Connection ID (matches source.connection)
    name  - Human-readable connection name
    host  - ClickHouse host URL

Examples:
  $ hdx connections
  $ hdx connections --json
  $ hdx connections --json | jq '.[] | select(.name=="Default")'
`,
  )
  .action(async opts => {
    const client = await ensureSession(opts.appUrl);

    const connections = await client.getConnections();
    if (connections.length === 0) {
      if (opts.json) {
        process.stdout.write('[]\n');
      } else {
        process.stdout.write('No connections found.\n');
      }
      return;
    }

    if (opts.json) {
      const output = connections.map(c => ({
        id: c.id,
        name: c.name,
        host: c.host,
      }));
      process.stdout.write(JSON.stringify(output, null, 2) + '\n');
      return;
    }

    // Human-readable: one line per connection
    for (const c of connections) {
      process.stdout.write(
        `${chalk.bold.cyan(c.name)}  ${chalk.dim(c.host)}  ${chalk.dim(`[${c.id}]`)}\n`,
      );
    }
  });

// ---- Dashboards ----------------------------------------------------

program
  .command('dashboards')
  .description('List dashboards with tile summaries')
  .option('-a, --app-url <url>', 'HyperDX app URL')
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
    const client = await ensureSession(opts.appUrl);

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
          type: t.config.displayType ?? null,
          source: ('source' in t.config ? t.config.source : null) ?? null,
          sql:
            ('sqlTemplate' in t.config ? t.config.sqlTemplate : null) ?? null,
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
        const chartType = t.config.displayType ?? 'chart';
        const tileSource = 'source' in t.config ? t.config.source : undefined;
        let sourceLabel = '';
        if ('sqlTemplate' in t.config) {
          sourceLabel = 'raw SQL';
        } else if (tileSource) {
          sourceLabel = `source: ${sourceNames[tileSource] ?? tileSource}`;
        }
        const meta = [chartType, sourceLabel].filter(Boolean).join(', ');
        process.stdout.write(
          `${chalk.dim(prefix)}${name} ${chalk.dim(`(${meta})`)}\n`,
        );
      }

      process.stdout.write('\n');
    }
  });

// ---- Chart ---------------------------------------------------------

/** Parse a relative duration like "15m", "1h", "7d" into milliseconds. */
function parseDuration(input: string): number | null {
  const match = input.trim().match(/^(\d+)\s*(s|m|h|d|w)$/i);
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  const ms =
    unit === 's'
      ? 1000
      : unit === 'm'
        ? 60_000
        : unit === 'h'
          ? 3_600_000
          : unit === 'd'
            ? 86_400_000
            : 7 * 86_400_000;
  return n * ms;
}

program
  .command('chart')
  .description(
    'Render charts in the terminal — dashboard tiles or ad-hoc queries',
  )
  .option('-d, --dashboard <name-or-id>', 'Dashboard name or ID (tile mode)')
  .option(
    '-t, --tile <name-or-id>',
    'Render only the tile matching this name or ID (default: all tiles)',
  )
  .option('-s, --source <name-or-id>', 'Source name or ID (ad-hoc mode)')
  .option(
    '--display <type>',
    'Chart type: line, stacked_bar, number, table, bar, pie (ad-hoc mode)',
    'line',
  )
  .option(
    '--agg <fn>',
    'Aggregation: count, sum, avg, min, max, count_distinct, quantile',
    'count',
  )
  .option('--value <expression>', 'Column/SQL expression to aggregate')
  .option('--level <fraction>', 'Quantile level for --agg quantile (0.95)')
  .option('--where <condition>', 'Filter condition (Lucene by default)')
  .option('--language <lang>', 'Filter language: lucene or sql', 'lucene')
  .option('--group-by <expression>', 'Group-by column/expression')
  .option(
    '--metric-type <type>',
    'Metric kind for metric sources: gauge, sum, histogram',
  )
  .option('--metric-name <name>', 'OTel metric name for metric sources')
  .option(
    '--series <json>',
    'Full select item as JSON (repeatable, overrides --agg/--value)',
    (value: string, prev: string[]) => [...prev, value],
    [] as string[],
  )
  .option('--sql <query>', 'Raw ClickHouse SQL to chart (raw SQL mode)')
  .option(
    '--connection-id <id>',
    'ClickHouse connection for --sql (alternative to --source)',
  )
  .option('--since <duration>', 'Relative time range (e.g. 15m, 1h, 7d)', '1h')
  .option(
    '--from <time>',
    'Range start: ISO 8601, date (2026-07-01), or relative (now-24h). Overrides --since',
  )
  .option(
    '--to <time>',
    'Range end: ISO 8601, date, or relative (now-1h). Default: now',
  )
  .option(
    '--granularity <interval>',
    'Time bucket size (e.g. "5 minute") or "auto"',
    'auto',
  )
  .option('--width <n>', 'Chart width in columns (default: terminal width)')
  .option('--height <n>', 'Chart height in rows', '16')
  .option(
    '--color <mode>',
    'ANSI colors: auto (TTY only), always, never',
    'auto',
  )
  .option('--json', 'Output the queried rows + metadata as JSON instead')
  .option('-a, --app-url <url>', 'HyperDX app URL')
  .addHelpText(
    'after',
    `
About:
  Renders charts as terminal output. Designed for troubleshooting from
  the CLI (including by AI agents): visualize a metric, spot the spike,
  then narrow down with --where, 'hdx query', or 'hdx stream'.

  All modes query through the exact same renderChartConfig pipeline the
  web dashboards use, so SQL and results match the web UI.

Modes (pick one):
  1. Dashboard tiles:  -d <dashboard> [-t <tile>]
     Renders saved dashboard tiles. Use 'hdx dashboards' to discover
     dashboards and tile names/IDs.
  2. Ad-hoc builder:   -s <source> [--agg ... --value ... --where ...]
     Charts an aggregation over a source. Use 'hdx sources --json' to
     discover sources (log, trace, and metric kinds all work).
  3. Ad-hoc raw SQL:   --sql <query> with -s <source> or --connection-id
     Charts arbitrary SQL. Time-series SQL should produce a time bucket
     column and numeric value column(s); macros are supported:
       $__timeFilter(col)    — expands to the --since/--from/--to range
       $__timeInterval(col)  — buckets by the chart granularity

Display types (--display):
  line (default), stacked_bar, number, table, bar, pie.
  For line/stacked_bar the result is bucketed over time. number shows a
  single value. table prints rows. bar/pie aggregate per --group-by.

Time range:
  --since takes a relative duration ending now (15m, 1h, 7d).
  --from / --to take absolute or relative times and override --since:
    ISO 8601:   2026-07-01T00:00:00Z
    Date only:  2026-07-01 (start of day UTC)
    Relative:   now, now-30m, now-24h, now-7d

Output:
  ANSI colors are stripped automatically when stdout is not a TTY
  (override with --color always|never). Use --json for raw rows + column
  metadata instead of a rendered chart.

Exit codes:
  0  Success.
  1  Failure (unknown dashboard/tile/source, invalid flags, query error).

Examples:
  # Dashboard tiles
  $ hdx chart -d "Service Health"                # All tiles, past 1h
  $ hdx chart -d "Service Health" -t "P95 Latency" --since 24h

  # Ad-hoc: error log volume by service, past 3h
  $ hdx chart -s Logs --where 'SeverityText:error' --group-by ServiceName --since 3h

  # Ad-hoc: p95 span duration for one service
  $ hdx chart -s Traces --agg quantile --level 0.95 --value Duration \\
      --where 'ServiceName:api' --since 6h

  # Ad-hoc: top services by error count (bar chart)
  $ hdx chart -s Logs --display bar --where 'SeverityText:error' --group-by ServiceName

  # Ad-hoc: metric source
  $ hdx chart -s Metrics --metric-type sum --metric-name otelcol_exporter_sent_spans

  # Ad-hoc: raw SQL over a time range
  $ hdx chart -s Logs --sql "SELECT \\$__timeInterval(TimestampTime) AS ts, count()
      FROM default.otel_logs WHERE \\$__timeFilter(TimestampTime) GROUP BY ts ORDER BY ts"

  # Agent-friendly structured output
  $ hdx chart -s Logs --group-by ServiceName --json | jq '.[0].data'
`,
  )
  .action(async opts => {
    const client = await ensureSession(opts.appUrl);
    const chClient = client.createClickHouseClient();
    const metadata = client.createMetadata();

    // ---- Resolve time range
    // --from/--to accept ISO 8601, date-only, or relative (now-1h) via
    // the same parser as the TUI's $EDITOR time-range editor.
    const timeFormatHint =
      'Supported formats: ISO 8601 (2026-07-01T00:00:00Z), date (2026-07-01), relative (now, now-30m, now-24h, now-7d).';
    let to: Date;
    if (opts.to) {
      const parsed = parseTimeValue(opts.to);
      if (!parsed) {
        _origError(
          chalk.red(`Invalid --to value "${opts.to}". ${timeFormatHint}\n`),
        );
        process.exit(1);
      }
      to = parsed;
    } else {
      to = new Date();
    }
    let from: Date;
    if (opts.from) {
      const parsed = parseTimeValue(opts.from);
      if (!parsed) {
        _origError(
          chalk.red(`Invalid --from value "${opts.from}". ${timeFormatHint}\n`),
        );
        process.exit(1);
      }
      from = parsed;
    } else {
      const durationMs = parseDuration(opts.since);
      if (durationMs == null) {
        _origError(
          chalk.red(
            `Invalid --since value "${opts.since}". Use formats like 15m, 1h, 7d.\n`,
          ),
        );
        process.exit(1);
      }
      from = new Date(to.getTime() - durationMs);
    }
    if (from >= to) {
      _origError(
        chalk.red(
          `Invalid time range: start (${from.toISOString()}) must be before end (${to.toISOString()}).\n`,
        ),
      );
      process.exit(1);
    }

    // ---- Mode validation
    const isAdhoc = !!(opts.source || opts.sql);
    if (opts.dashboard && isAdhoc) {
      _origError(
        chalk.red(
          'Pick one mode: -d/--dashboard (tile mode) or -s/--source / --sql (ad-hoc mode).\n',
        ),
      );
      process.exit(1);
    }
    if (!opts.dashboard && !isAdhoc) {
      _origError(
        chalk.red(
          'Nothing to chart. Use -d <dashboard> for saved tiles, or -s <source> / --sql for ad-hoc charts. See: hdx chart --help\n',
        ),
      );
      process.exit(1);
    }

    // ---- Output settings
    const width = opts.width
      ? Number(opts.width)
      : Math.min(process.stdout.columns || 100, 140);
    const height = Number(opts.height);
    const dateRange: [Date, Date] = [from, to];
    const parsedGranularity = parseGranularityFlag(String(opts.granularity));
    if (!parsedGranularity) {
      _origError(
        chalk.red(
          `Invalid --granularity "${opts.granularity}". Use "auto" or "<n> second|minute|hour|day" (e.g. "5 minute").\n`,
        ),
      );
      process.exit(1);
    }
    const granularity = parsedGranularity.granularity;
    const maxTimeBuckets = Math.max(20, Math.min(80, width - 14));

    // Colors: strip ANSI when stdout is not a TTY (agents/pipes) unless
    // forced. chalk auto-detects TTY on its own; forcing "always" bumps
    // its level so headers stay colored when piped too.
    const colorMode = String(opts.color);
    if (!['auto', 'always', 'never'].includes(colorMode)) {
      _origError(
        chalk.red(
          `Invalid --color value "${opts.color}". Use auto, always, or never.\n`,
        ),
      );
      process.exit(1);
    }
    const useColors =
      colorMode === 'always' ||
      (colorMode === 'auto' && !!process.stdout.isTTY);
    if (colorMode === 'always' && chalk.level === 0) {
      chalk.level = 3;
    }
    const finalize = (s: string): string => (useColors ? s : stripAnsi(s));

    const jsonOutput: Array<Record<string, unknown>> = [];
    let hadError = false;

    /** Query + render one chart config; shared by both modes. */
    const renderOne = async ({
      id,
      name,
      config,
      source,
    }: {
      id: string | null;
      name: string;
      config: SavedChartConfig;
      source: SourceResponse | undefined;
    }) => {
      try {
        const result = await fetchTileData({
          clickhouseClient: chClient,
          metadata,
          config,
          source,
          dateRange,
          granularity,
          maxTimeBuckets,
        });

        if (opts.json) {
          jsonOutput.push({
            id,
            name,
            displayType: config.displayType ?? null,
            status: result.status,
            ...(result.status === 'ok'
              ? { data: result.data.data, meta: result.data.meta }
              : {}),
            ...(result.status === 'unsupported'
              ? { message: result.message }
              : {}),
            ...(result.status === 'unresolved'
              ? { message: result.resolution.message }
              : {}),
          });
          return;
        }

        process.stdout.write(
          finalize(
            `${chalk.bold.cyan(name)} ${chalk.dim(`(${config.displayType ?? 'chart'})`)}\n`,
          ),
        );
        const content = renderTileContent({ result, source, width, height });
        process.stdout.write(finalize(content) + '\n\n');
      } catch (err) {
        hadError = true;
        const msg = err instanceof Error ? err.message : String(err);
        if (opts.json) {
          jsonOutput.push({ id, name, status: 'error', error: msg });
        } else {
          process.stdout.write(finalize(`${chalk.bold.cyan(name)}\n`));
          process.stdout.write(finalize(chalk.red(`Query failed: ${msg}\n\n`)));
        }
      }
    };

    if (isAdhoc) {
      // ---- Ad-hoc mode (builder or raw SQL)
      const sources = await client.getSources();
      let adhoc;
      try {
        adhoc = buildAdhocChartConfig(
          {
            source: opts.source,
            sql: opts.sql,
            connectionId: opts.connectionId,
            display: opts.display,
            agg: opts.agg,
            value: opts.value,
            level: opts.level,
            metricType: opts.metricType,
            metricName: opts.metricName,
            where: opts.where,
            language: opts.language,
            groupBy: opts.groupBy,
            series: opts.series,
          },
          sources,
        );
      } catch (err) {
        if (err instanceof AdhocChartError) {
          _origError(chalk.red(`${err.message}\n`));
          process.exit(1);
        }
        throw err;
      }

      await renderOne({
        id: null,
        name: adhoc.label,
        config: adhoc.config,
        source: adhoc.source,
      });
    } else {
      // ---- Dashboard tile mode
      const [dashboards, sources] = await Promise.all([
        client.getDashboards(),
        client.getSources(),
      ]);
      const needle = String(opts.dashboard).toLowerCase();
      const dashboard = dashboards.find(
        d =>
          d.id === opts.dashboard ||
          d._id === opts.dashboard ||
          d.name.toLowerCase() === needle,
      );
      if (!dashboard) {
        _origError(chalk.red(`Dashboard "${opts.dashboard}" not found.\n`));
        _origError('Available dashboards:');
        for (const d of dashboards) {
          _origError(`  - ${d.name} [${d.id ?? d._id}]`);
        }
        process.exit(1);
      }

      let tiles = sortTilesForDisplay(dashboard.tiles);
      if (opts.tile) {
        const tileNeedle = String(opts.tile).toLowerCase();
        tiles = tiles.filter(
          t =>
            t.id === opts.tile ||
            (t.config.name ?? '').toLowerCase() === tileNeedle,
        );
        if (tiles.length === 0) {
          _origError(
            chalk.red(
              `Tile "${opts.tile}" not found in dashboard "${dashboard.name}".\n`,
            ),
          );
          _origError('Available tiles:');
          for (const t of sortTilesForDisplay(dashboard.tiles)) {
            _origError(`  - ${t.config.name || '(untitled)'} [${t.id}]`);
          }
          process.exit(1);
        }
      }

      for (const tile of tiles) {
        const sourceId =
          'source' in tile.config ? tile.config.source : undefined;
        const source = sources.find(
          s => s.id === sourceId || s._id === sourceId,
        );
        await renderOne({
          id: tile.id,
          name: tile.config.name || '(untitled)',
          config: tile.config,
          source,
        });
      }
    }

    if (opts.json) {
      process.stdout.write(JSON.stringify(jsonOutput, null, 2) + '\n');
    }
    if (hadError) {
      process.exit(1);
    }
  });

// ---- Query ---------------------------------------------------------

program
  .command('query')
  .description(
    'Run raw SQL against a ClickHouse connection (add --patterns to cluster result into Drain log patterns)',
  )
  .requiredOption(
    '--connection-id <id>',
    "Connection ID (from 'hdx connections --json')",
  )
  .requiredOption('--sql <query>', 'SQL query to execute')
  .option('-a, --app-url <url>', 'HyperDX app URL')
  .option('--format <format>', 'ClickHouse output format', 'JSONEachRow')
  .option(
    '--patterns',
    'Mine Drain log patterns from the query result instead of emitting rows',
  )
  .option(
    '--body-column <name>',
    'Column whose string value is clustered when --patterns is set (default: whole row JSON)',
  )
  .addHelpText(
    'after',
    `
About:
  Execute a raw ClickHouse SQL query through the HyperDX proxy, using
  a configured ClickHouse connection. Designed for ad-hoc exploration,
  debugging, and agent-driven queries.

  The --connection-id flag takes a connection ID. Use 'hdx connections
  --json' to discover available connection IDs. Use 'hdx sources --json'
  to see which connection each source uses (the 'connection' field).

  The query is sent as-is to ClickHouse — you are responsible for
  writing valid SQL. Output is written to stdout. Use --format to
  control the ClickHouse response format (JSONEachRow, JSON,
  TabSeparated, CSV, etc.). The default is JSONEachRow (one JSON
  object per line) — streamable and easy to consume from agents and
  shell pipelines (e.g. \`jq -c\`).

Pattern mining (--patterns):
  Cluster the result's text into log patterns using the Drain
  algorithm, then emit one JSON object per pattern (sorted by count
  desc). Useful for summarizing a large result set into a small
  number of templated lines.

  Drain runs in-process over whatever rows the SQL returns, so the
  result quality depends on the rows you give it:

    --body-column <name>
      When set, only that column's string value is clustered. Useful
      when you SELECT * but only want to mine over (e.g.) Body or
      SpanName. If <name> isn't in the result, the command exits 1
      and lists available columns on stderr.

      When omitted, the whole row is JSON-serialized and clustered as
      a single string. This works for any SELECT shape without column
      guessing, but produces noisier templates than clustering a
      single text column.

  Sampling tip:
    For very large tables, prefer sampling over a tight LIMIT to
    avoid biasing toward a single time slice. Append \`ORDER BY rand()\`
    to your SQL, e.g.:

      --sql "SELECT Body FROM default.otel_logs
             WHERE Timestamp > now() - INTERVAL 1 HOUR
             ORDER BY rand() LIMIT 10000"

    Be aware: \`ORDER BY rand()\` forces ClickHouse to scan and sort
    all rows matched by the WHERE clause before applying LIMIT, which
    can be expensive on large tables. Always pair it with a selective
    WHERE (time range, service, severity, etc.) to bound the scan.

  Output forces JSON internally regardless of --format. Each line is:
    {"pattern":"<template>","count":<n>,"sample":"<first sample>"}

Exit codes:
  0  Success. Stdout contains the result (empty stdout means zero rows).
  1  Failure. Stderr contains the error.

Examples:
  $ CONN=$(hdx connections --json | jq -r '.[0].id')
  $ hdx query --connection-id "$CONN" --sql "SELECT count() FROM default.otel_logs"
  $ hdx query --connection-id "$CONN" --sql "SELECT * FROM default.otel_traces LIMIT 5"
  $ hdx query --connection-id "$CONN" --patterns \\
      --sql "SELECT Body FROM default.otel_logs LIMIT 10000" --body-column Body
`,
  )
  .action(async opts => {
    const client = await ensureSession(opts.appUrl);
    const chClient = client.createClickHouseClient();

    try {
      if (opts.patterns) {
        // Pattern mining forces JSON internally so we can iterate named rows.
        if (
          opts.format &&
          opts.format !== 'JSON' &&
          opts.format !== 'JSONEachRow'
        ) {
          _origError(
            chalk.dim('--patterns: ignoring --format, using JSON internally\n'),
          );
        }
        const resultSet = await chClient.query({
          query: opts.sql,
          format: 'JSON',
          connectionId: opts.connectionId,
        });
        const json = (await resultSet.json()) as {
          data?: Array<Record<string, unknown>>;
        };
        const rows = json.data ?? [];
        if (rows.length === 0) {
          return; // exit 0, empty stdout
        }

        // If --body-column was provided, validate it exists in the result.
        if (opts.bodyColumn) {
          const cols = Object.keys(rows[0]);
          if (!cols.includes(opts.bodyColumn)) {
            _origError(
              chalk.red(
                `--body-column '${opts.bodyColumn}' not found in result. ` +
                  `Available columns: ${cols.join(', ')}\n`,
              ),
            );
            process.exit(1);
          }
        }

        const flatten = (s: string): string =>
          s
            .replace(/\n/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();

        const miner = new TemplateMiner(new TemplateMinerConfig());
        const groups = new Map<number, { count: number; sample: string }>();
        for (const row of rows) {
          const raw = opts.bodyColumn
            ? row[opts.bodyColumn]
            : JSON.stringify(row);
          const text = raw != null ? flatten(String(raw)) : '';
          const { clusterId } = miner.addLogMessage(text);
          const existing = groups.get(clusterId);
          if (existing) {
            existing.count += 1;
          } else {
            groups.set(clusterId, { count: 1, sample: text });
          }
        }

        const out: Array<{ pattern: string; count: number; sample: string }> =
          [];
        for (const [, g] of groups) {
          const tpl =
            miner.match(g.sample, 'fallback')?.getTemplate() ?? g.sample;
          out.push({ pattern: tpl, count: g.count, sample: g.sample });
        }
        out.sort((a, b) => b.count - a.count);

        for (const p of out) {
          process.stdout.write(JSON.stringify(p) + '\n');
        }
        return;
      }

      // Default: raw SQL → stdout in the requested format.
      const resultSet = await chClient.query({
        query: opts.sql,
        format: opts.format,
        connectionId: opts.connectionId,
      });
      const text = await resultSet.text();
      process.stdout.write(text);
      // Ensure trailing newline for clean terminal output
      if (text.length > 0 && !text.endsWith('\n')) {
        process.stdout.write('\n');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // On error, check whether the connection ID was even valid —
      // gives agents a clear signal of which class of failure occurred.
      try {
        const connections = await client.getConnections();
        const known = connections.some(
          c => c.id === opts.connectionId || c._id === opts.connectionId,
        );
        if (!known) {
          _origError(
            chalk.red(`Connection "${opts.connectionId}" not found.\n`),
          );
          _origError('Available connections:');
          for (const c of connections) {
            _origError(`  - ${c.name} [${c.id}]`);
          }
          process.exit(1);
        }
      } catch {
        // Couldn't list connections — fall through to the generic error.
      }

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
  .option(
    '--apiVersion [string]',
    'The API version to use (v1 for HyperDX V1 Cloud, v2 for latest)',
    'v1',
  )
  .action(async opts => {
    try {
      await uploadSourcemaps(opts);
    } catch (err) {
      // uploadSourcemaps already prints user-facing messages via logError().
      // Append a short reason line for machine-readable CI logs and exit non-zero.
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${chalk.red(`Upload failed: ${msg}`)}\n`);
      process.exit(1);
    }
  });

program.parse();
