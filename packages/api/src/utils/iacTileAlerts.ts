import { isTileAlertUnaddressable } from '@hyperdx/common-utils/dist/iac';
import { serializeError } from 'serialize-error';

import type { ObjectId } from '@/models';
import { AlertSource } from '@/models/alert';
import Dashboard from '@/models/dashboard';
import { getCounter } from '@/utils/instrumentation';
import logger from '@/utils/logger';

const tileAlertLookupFailures = getCounter(
  'hyperdx.iac.tile_alert_lookup_failed',
  {
    description:
      "Failures to read the dashboards a team's tile alerts point at, each of which withholds every tile alert from Terraform export.",
  },
);

type TileAlertRow = {
  _id: ObjectId;
  source?: AlertSource;
  dashboard?: ObjectId | null;
  tileId?: string | null;
};

/**
 * Which of these alerts the Terraform provider cannot address, by alert id.
 *
 * A tile alert's eligibility depends on its dashboard — whether Terraform
 * could own it at all, and whether the tile has a unique, non-blank name for
 * the provider's `tile_ids` map. The manifest's own dashboards listing cannot
 * answer that: it drops provisioned dashboards and caps at
 * IAC_MANIFEST_LIMIT. Hence this separate, narrower read, keyed on the
 * dashboards the tile alerts actually point at.
 *
 * Bounded by its own `$in`, which is why it needs no `limit`: the ids come
 * from the alerts listing, itself capped at IAC_MANIFEST_LIMIT. `maxTimeMS` is
 * the caller's remaining budget, not a fresh one — this read is sequenced
 * after the manifest's six concurrent listings, and the ceiling is meant to
 * bound the request, not each leg of it. If it fails, expires, or the budget
 * is already spent, every tile alert is reported unaddressable rather than
 * failing the manifest.
 */
export async function unaddressableTileAlertIds({
  teamId,
  alerts,
  maxTimeMS,
}: {
  teamId: ObjectId | string;
  alerts: readonly TileAlertRow[];
  maxTimeMS: number;
}): Promise<Set<string>> {
  const tileAlerts = alerts.filter(a => a.source === AlertSource.TILE);
  const dashboardIds = [
    ...new Set(
      tileAlerts
        .map(a => a.dashboard?.toString())
        .filter((id): id is string => !!id),
    ),
  ];

  const allTileAlertIds = () => new Set(tileAlerts.map(a => a._id.toString()));
  if (!dashboardIds.length) return allTileAlertIds();

  // This read decides one optional marker, so it must not take the whole
  // manifest with it — the other six listings are the export. It runs last on
  // what is left of the request's budget, so it is the leg most likely to be
  // short of time.
  const withhold = (message: string, error?: unknown) => {
    logger.warn({
      message,
      error: error == null ? undefined : serializeError(error),
      teamId: teamId.toString(),
      tileAlerts: tileAlerts.length,
    });
    tileAlertLookupFailures.add(1);
  };

  // Mongo reads `maxTimeMS: 0` as "no limit", so a spent budget cannot be
  // passed through — and a floor under it would push the request past the
  // ceiling this read is meant to stay inside. Skipped rather than run
  // unbounded, which lands on the same answer an expired read gives.
  if (maxTimeMS <= 0) {
    withhold(
      'No budget left to resolve tile-alert addressability; withholding all',
    );
    return allTileAlertIds();
  }

  // Handled with `then(ok, err)` rather than try/catch so the row type stays
  // inferred from the query — a `let` declared ahead of a try block widens to
  // any and the predicate below stops type-checking against the projection.
  const dashboards = await Dashboard.find(
    { team: teamId, _id: { $in: dashboardIds } },
    // Only what isTileAlertUnaddressable reads. Keep in step with it.
    { provisioned: 1, 'tiles.id': 1, 'tiles.config.name': 1 },
  )
    .maxTimeMS(maxTimeMS)
    .lean()
    .then(
      rows => rows,
      (e: unknown) => {
        withhold(
          'Failed to resolve tile-alert addressability; withholding all',
          e,
        );
        return null;
      },
    );
  // Withheld rather than offered unchecked: the export comes up short, which
  // both the generated file and the UI report, instead of carrying an alert
  // whose reference cannot resolve.
  if (dashboards == null) return allTileAlertIds();

  const byId = new Map(dashboards.map(d => [d._id.toString(), d]));

  return new Set(
    tileAlerts
      .filter(a =>
        // A dangling dashboard or tile reference lands here too, which is the
        // right answer: importing that alert would fail.
        isTileAlertUnaddressable(
          byId.get(a.dashboard?.toString() ?? ''),
          a.tileId,
        ),
      )
      .map(a => a._id.toString()),
  );
}
