/**
 * Direct metadata-store and ClickHouse access helpers for full-stack E2E tests. Only
 * usable in full-stack mode (DocumentDB via docker-compose); there is no database in
 * local mode, so callers must gate on `{ tag: ['@full-stack'] }`.
 */
import { type Db, MongoClient } from 'mongodb';

export { ObjectId } from 'mongodb';

const E2E_DB_NAME = 'hyperdx-e2e';

// Built from the e2e slot port rather than MONGO_URI, so a MONGO_URI exported in a
// developer's shell can never point these destructive helpers at another database.
function e2eMongoUri(): string {
  return `mongodb://hyperdx:hyperdx@localhost:${process.env.HDX_E2E_MONGO_PORT || '21100'}/${E2E_DB_NAME}?tls=true&tlsAllowInvalidCertificates=true&authMechanism=SCRAM-SHA-256`;
}

/** Runs `fn` against the e2e database over the Mongo wire protocol. */
export async function withE2eDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await MongoClient.connect(e2eMongoUri());
  try {
    return await fn(client.db(E2E_DB_NAME));
  } finally {
    await client.close();
  }
}

/**
 * Drops the e2e database. DocumentDB intermittently fails this while the API's
 * background index builds run (WriteConflict 112, or InternalError 1).
 */
export async function dropE2eDatabase(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await withE2eDb(db => db.dropDatabase());
      return;
    } catch (e: any) {
      if (attempt >= 5 || ![1, 112].includes(e?.code)) throw e;
      await new Promise(resolve => setTimeout(resolve, 200 * attempt));
    }
  }
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
export async function setTeamFlag(
  flagName: string,
  value: boolean,
): Promise<void> {
  await withE2eDb(db =>
    db.collection('teams').updateOne({}, { $set: { [flagName]: value } }),
  );
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
