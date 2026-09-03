/**
 * Direct MongoDB access helpers for full-stack E2E tests. Only usable in
 * full-stack mode (real Mongo via docker-compose) — there is no database in
 * local mode, so callers must gate on `{ tag: ['@full-stack'] }`.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Run a mongosh script against the e2e MongoDB container by piping the script
 * through stdin. Using stdin (rather than `--eval "<...>"`) avoids having to
 * escape quotes in the script body, so callers can pass multi-line JavaScript
 * with string literals verbatim.
 *
 * `execFileSync` with an argument array rather than a shell string: the project
 * slug comes from an env var, and with no shell nothing in it can be read as a
 * metacharacter.
 *
 * Throws if the docker-compose file can't be found (meaning we're not running
 * in the expected Docker-backed e2e environment).
 */
export function runMongoshScript(script: string): string {
  const dockerComposeFile = path.join(__dirname, '..', 'docker-compose.yml');
  if (!fs.existsSync(dockerComposeFile)) {
    throw new Error(
      `docker-compose.yml not found at ${dockerComposeFile} — e2e Docker stack unavailable`,
    );
  }

  const e2eSlot = process.env.HDX_E2E_SLOT || '0';

  return execFileSync(
    'docker',
    [
      'compose',
      '-p',
      `e2e-${e2eSlot}`,
      '-f',
      dockerComposeFile,
      'exec',
      '-T',
      'db',
      'mongosh',
      '--quiet',
    ],
    {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      input: script,
    },
  );
}

/**
 * Sets a boolean field directly on the (single, seeded) e2e team document.
 * There's no settings UI or API endpoint for team feature flags yet, so
 * direct DB writes are the only way to toggle them for a test.
 *
 * This app only ever has one team per deployment (`/register/password`
 * 409s with `teamAlreadyExists` once any team exists — see
 * `isTeamExisting` in packages/api/src/controllers/team.ts), so there's
 * nothing to scope by. Tests that toggle a flag here should still avoid
 * racing each other — e.g. via `test.describe.serial(...)` — since
 * `fullyParallel: true` lets tests in the same file run concurrently.
 */
export function setTeamFlag(flagName: string, value: boolean): void {
  runMongoshScript(`
use('hyperdx-e2e');
db.teams.updateOne({}, { $set: { [${JSON.stringify(flagName)}]: ${JSON.stringify(value)} } });
`);
}

const CLICKHOUSE_HOST =
  process.env.CLICKHOUSE_HOST ||
  `http://localhost:${process.env.HDX_E2E_CH_PORT || '20500'}`;

/** ClickHouse HTTP endpoint with credentials, as the E2E stack exposes it. */
function clickhouseUrl(): string {
  const url = new URL(CLICKHOUSE_HOST);
  url.searchParams.set('user', process.env.CLICKHOUSE_USER || 'default');
  if (process.env.CLICKHOUSE_PASSWORD) {
    url.searchParams.set('password', process.env.CLICKHOUSE_PASSWORD);
  }
  return url.toString();
}

/** Runs a statement, throwing on a non-2xx so a failed seed is not silent. */
export async function clickhouseExec(sql: string): Promise<void> {
  const response = await fetch(clickhouseUrl(), {
    method: 'POST',
    body: sql,
    headers: { 'Content-Type': 'text/plain' },
  });
  if (!response.ok) {
    throw new Error(
      `ClickHouse query failed (${response.status}): ${await response.text()}`,
    );
  }
}

/** Runs a SELECT and returns one trimmed line per row (TSV). */
export async function clickhouseSelect(sql: string): Promise<string[]> {
  const response = await fetch(clickhouseUrl(), {
    method: 'POST',
    body: `${sql} FORMAT TSV`,
    headers: { 'Content-Type': 'text/plain' },
  });
  if (!response.ok) {
    throw new Error(
      `ClickHouse query failed (${response.status}): ${await response.text()}`,
    );
  }
  return (await response.text()).trim().split('\n').filter(Boolean);
}
