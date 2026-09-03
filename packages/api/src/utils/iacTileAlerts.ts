import {
  IAC_MANIFEST_LIMIT,
  isTileAlertUnaddressable,
} from '@hyperdx/common-utils/dist/iac';

import type { ObjectId } from '@/models';
import { AlertSource } from '@/models/alert';
import Dashboard from '@/models/dashboard';

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
 * Bounded the same way the manifest's listings are, and for the same reason —
 * the fan-out is one id per tile alert, and this runs on every Team Settings
 * visit. Past the cap a dashboard's tiles go unread, which marks its alerts
 * unaddressable: withholding an alert that would have worked, rather than
 * offering one that would not.
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

  const dashboards = dashboardIds.length
    ? await Dashboard.find(
        { team: teamId, _id: { $in: dashboardIds } },
        // Only what isTileAlertUnaddressable reads. Keep in step with it.
        { provisioned: 1, 'tiles.id': 1, 'tiles.config.name': 1 },
      )
        .sort({ _id: 1 })
        .limit(IAC_MANIFEST_LIMIT)
        .maxTimeMS(maxTimeMS)
        .lean()
    : [];
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
