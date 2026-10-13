/**
 * Optimistic concurrency for dashboard writes, keyed on an explicit
 * `version` counter.
 *
 * `version` is server-owned via schema middleware on `Dashboard`
 * (`@/models/dashboard.ts`): every update operation gets an `$inc` and any
 * client-supplied `version` is stripped, so a write path added later gets
 * the guard for free without a call site having to remember to bump it
 * itself. A guarded write puts the caller's token into the
 * `findOneAndUpdate` filter, making the write conditional on nobody else
 * having written since they read.
 *
 * This is deliberately not `updatedAt`. An integer counter is monotonic per
 * write with no same-millisecond hole, whereas `updatedAt` overloads a
 * display field with a correctness role and ties that correctness to
 * mongoose's timestamp internals rather than to something this module
 * controls directly.
 *
 * The token stays opaque at every boundary (a string, even though it is an
 * integer underneath) so the representation can change again without
 * breaking agents or API clients.
 *
 * Known gap: tile alerts live in the separate `Alert` collection, so adding
 * or editing one doesn't bump the dashboard's `version`. That's harmless on
 * the MCP and v2 surfaces, but the internal PATCH route runs
 * `syncDashboardAlerts` (`@/controllers/dashboard.ts`), which deletes alerts
 * for any tile that had one in its fresh read and doesn't have one in the
 * incoming payload. So a save whose guard passes cleanly can still delete an
 * alert someone else added in between — the version token says nothing about
 * alert state. Pre-existing, not introduced or worsened here.
 */

import type { ObjectId } from '@/models';
import Dashboard from '@/models/dashboard';
import { getCounter } from '@/utils/instrumentation';

// Deliberately strict: a loose parse (e.g. accepting '1.5', leading
// whitespace, or a leading zero that `versionToken` never emits) turns a
// client's malformed token into a bogus "someone else edited this" instead
// of the client error it is.
const VERSION_TOKEN = /^(0|[1-9]\d*)$/;

export function versionToken(doc: { version: number }): string {
  return String(doc.version);
}

export function parseVersionToken(raw: string): number | null {
  if (!VERSION_TOKEN.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function dashboardETag(doc: { version: number }): string {
  return `"${versionToken(doc)}"`;
}

/**
 * Builds the `version` clause for a guarded write filter. A dashboard
 * created before `version` existed has no such field in MongoDB, and
 * hydration reports that as `0` (the schema default), but Mongo equality on
 * `0` doesn't match a missing field — only `null` does. Matching `0` against
 * `$in: [0, null]` lets token `"0"` land on both a pre-migration document and
 * a backfilled one, so correctness never depends on the migration having
 * run. Every non-zero token keeps exact-match semantics.
 */
export function versionFilter(v: number): Record<string, unknown> {
  return v === 0 ? { version: { $in: [0, null] } } : { version: v };
}

/**
 * Parses a single `If-Match` value. RFC 9110 allows a comma-separated list;
 * we accept one entry (or `*`) and reject a list, which surfaces as a 400
 * rather than quietly honouring only the first entry.
 */
export function parseIfMatch(header: string): number | '*' | null {
  const raw = header.trim();
  if (raw === '*') return '*';
  const unwrapped = raw.replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
  return parseVersionToken(unwrapped);
}

export type DashboardWriteMiss =
  | { kind: 'deleted' }
  | { kind: 'conflict'; currentVersion: string };

/** The call sites of {@link resolveDashboardWriteMiss}, for the `surface` metric attribute. */
export type DashboardWriteSurface =
  | 'mcp_save'
  | 'mcp_patch'
  | 'v2_put'
  | 'internal_patch';

/** Thrown by the dashboard controller so the router can map it to a 409. */
export class DashboardVersionConflictError extends Error {
  constructor(public readonly currentVersion: string) {
    super('Dashboard was modified by someone else');
    this.name = 'DashboardVersionConflictError';
  }
}

// Single choke point for the write-conflict/deletion outcome across all
// three surfaces (MCP, v2, internal). kind/surface only — no dashboard or
// team id, so this stays low-cardinality.
const writeConflictsCounter = getCounter('hyperdx.dashboards.write_conflicts', {
  description:
    'Count of dashboard writes rejected by the optimistic-concurrency guard, labeled by kind (conflict vs. deleted) and surface.',
});

/**
 * Explains why a version-guarded `findOneAndUpdate` matched nothing. Without
 * this every conflict reports as "dashboard not found", which sends the
 * caller down the wrong recovery path — an agent would give up instead of
 * re-reading and retrying.
 */
export async function resolveDashboardWriteMiss(
  dashboardId: string,
  teamId: string | ObjectId,
  surface: DashboardWriteSurface,
): Promise<DashboardWriteMiss> {
  const current = await Dashboard.findOne(
    { _id: dashboardId, team: teamId },
    { version: 1 },
  ).lean();
  // .lean() skips mongoose's defaults, so a pre-migration document with no
  // `version` field comes back as `current.version === undefined` here —
  // fall back to 0 so the token never surfaces the literal string
  // "undefined" in a 409/412 body or an MCP conflict message.
  const miss: DashboardWriteMiss =
    current == null
      ? { kind: 'deleted' }
      : {
          kind: 'conflict',
          currentVersion: versionToken({ version: current.version ?? 0 }),
        };
  writeConflictsCounter.add(1, { kind: miss.kind, surface });
  return miss;
}
