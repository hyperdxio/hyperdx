/**
 * Optimistic concurrency for dashboard writes, keyed on `updatedAt`.
 *
 * `updatedAt` is server-owned and needs no new field: mongoose's timestamp
 * plugin force-sets `$set.updatedAt` on every non-overwrite update and
 * deletes any client-supplied value, so a caller cannot pin it. A guarded
 * write puts the caller's token into the `findOneAndUpdate` filter, making
 * the write conditional on nobody else having written since they read.
 *
 * ponytail: millisecond precision, so two writes landing inside the same
 * millisecond both pass the guard. That is exactly today's behaviour, not a
 * regression. Upgrade path if it ever shows up in practice: an explicit
 * `version: Number` field with `$inc` at each write site.
 */

import type { ObjectId } from '@/models';
import Dashboard from '@/models/dashboard';

// Exactly the shape `Date.prototype.toISOString` produces. Deliberately
// strict: `new Date('2026')` succeeds and would yield a token that can never
// match a stored value, reporting a client's typo as somebody else's edit.
const ISO_8601_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function versionToken(doc: { updatedAt: Date }): string {
  return doc.updatedAt.toISOString();
}

export function parseVersionToken(raw: string): Date | null {
  if (!ISO_8601_MS.test(raw)) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function dashboardETag(doc: { updatedAt: Date }): string {
  return `"${versionToken(doc)}"`;
}

/**
 * Parses a single `If-Match` value. RFC 9110 allows a comma-separated list;
 * we accept one entry (or `*`) and reject a list, which surfaces as a 400
 * rather than quietly honouring only the first entry.
 */
export function parseIfMatch(header: string): Date | '*' | null {
  const raw = header.trim();
  if (raw === '*') return '*';
  const unwrapped = raw.replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
  return parseVersionToken(unwrapped);
}

export type DashboardWriteMiss =
  | { kind: 'deleted' }
  | { kind: 'conflict'; currentVersion: string };

/** Thrown by the dashboard controller so the router can map it to a 409. */
export class DashboardVersionConflictError extends Error {
  constructor(public readonly currentVersion: string) {
    super('Dashboard was modified by someone else');
    this.name = 'DashboardVersionConflictError';
  }
}

/**
 * Explains why a version-guarded `findOneAndUpdate` matched nothing. Without
 * this every conflict reports as "dashboard not found", which sends the
 * caller down the wrong recovery path — an agent would give up instead of
 * re-reading and retrying.
 */
export async function resolveDashboardWriteMiss(
  dashboardId: string,
  teamId: string | ObjectId,
): Promise<DashboardWriteMiss> {
  const current = await Dashboard.findOne(
    { _id: dashboardId, team: teamId },
    { updatedAt: 1 },
  ).lean();
  if (current == null) return { kind: 'deleted' };
  return { kind: 'conflict', currentVersion: versionToken(current) };
}
