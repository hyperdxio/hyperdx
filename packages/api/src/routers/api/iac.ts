import {
  dashboardHasUnexportableTiles,
  IAC_MANIFEST_LIMIT,
  type IacImportManifest,
  isImportableSource,
} from '@hyperdx/common-utils/dist/iac';
import express from 'express';
import type { Query } from 'mongoose';

import { getNonNullUserWithTeam } from '@/middleware/auth';
import Alert from '@/models/alert';
import Connection from '@/models/connection';
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';
import { Source } from '@/models/source';
import Webhook from '@/models/webhook';
import { unaddressableTileAlertIds } from '@/utils/iacTileAlerts';
import { getCounter, withSpan } from '@/utils/instrumentation';

const router = express.Router();

// IAC_MANIFEST_LIMIT is the per-type ceiling on the fan-out below (shared with
// the UI copy via common-utils). Six team-scoped finds run concurrently on
// every Team Settings visit and the browser's ky client is configured with
// `timeout: false`, so without a bound a large team can hang the page.
const IAC_MANIFEST_MAX_TIME_MS = 10_000;

const manifestTruncations = getCounter(
  'hyperdx.iac.import_manifest_truncated',
  {
    description:
      'Count of import-manifest requests where at least one listing hit IAC_MANIFEST_LIMIT.',
  },
);

const manifestUnexportableDashboards = getCounter(
  'hyperdx.iac.import_manifest_unexportable_dashboards',
  {
    description:
      'Dashboards withheld from Terraform export because a tile would not survive the import round trip.',
  },
);

const manifestUnaddressableTileAlerts = getCounter(
  'hyperdx.iac.import_manifest_unaddressable_tile_alerts',
  {
    description:
      "Tile alerts withheld from Terraform export because their tile has no unique, non-blank name for the provider's tile_ids map.",
  },
);

const manifestUnexportableSources = getCounter(
  'hyperdx.iac.import_manifest_unexportable_sources',
  {
    description:
      'Sources withheld from Terraform export because the provider cannot model their kind.',
  },
);

// Bounds a find without touching its result type. Only sort/limit/maxTimeMS
// are wrapped — all three return the same Query — so `.lean()` stays on the
// concrete model. Typing the whole chain instead collapses Source's
// discriminated union into its first member.
//
// The sort is what makes a capped listing meaningful: without it, *which*
// IAC_MANIFEST_LIMIT rows come back is planner-dependent and can differ
// between two calls, so a large team could get a different arbitrary subset
// each export. `{ team: 1, _id: 1 }` covers this ordering on every model here.
const bounded = <T extends Query<unknown, unknown>>(query: T): T =>
  query
    .sort({ _id: 1 })
    .limit(IAC_MANIFEST_LIMIT + 1)
    .maxTimeMS(IAC_MANIFEST_MAX_TIME_MS) as T;

/**
 * Each find asks for one row more than the ceiling, so a full page is
 * distinguishable from a result that happens to be exactly IAC_MANIFEST_LIMIT
 * long. Exported for the boundary test — an inverted comparison here turns a
 * partial export into one that looks complete.
 */
// Generic over the array, not its element: Source.find() returns a union of
// per-discriminator arrays, and inferring an element type collapses that union
// into its first member.
export function capListing<T extends readonly unknown[]>(
  rows: T,
): { items: T; truncated: boolean } {
  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    items: (rows as readonly unknown[]).slice(
      0,
      IAC_MANIFEST_LIMIT,
    ) as unknown as T,
    truncated: rows.length > IAC_MANIFEST_LIMIT,
  };
}

// Lean manifest for the "Export to Terraform" team-settings UI. Deliberately
// avoids the /dashboards and /alerts listing endpoints, which populate
// references and load whole documents. The dashboards leg reads two tile
// discriminators to decide exportability (see the projection below); nothing
// beyond ids, names and derived flags reaches the response.
router.get('/import-manifest', async (req, res, next) => {
  try {
    const { teamId } = getNonNullUserWithTeam(req);

    const manifest = await withSpan('iac.import_manifest', async span => {
      const [
        dashboardRows,
        alertRows,
        savedSearchRows,
        sourceRows,
        connectionRows,
        webhookRows,
      ] = await Promise.all([
        // Provisioned dashboards are machine-managed (ProvisionDashboardsTask)
        // and would conflict with Terraform-managed state.
        // Only the two discriminators `isUnexportableTile` reads, not whole
        // tile configs: a dashboard containing a tile the import round trip
        // would destroy must not be offered, and that is only knowable from
        // the configs — but SQL templates, select lists and filters have no
        // business leaving Mongo for a boolean. Keep this projection in step
        // with what that predicate inspects.
        bounded(
          Dashboard.find(
            { team: teamId, provisioned: { $ne: true } },
            {
              name: 1,
              'tiles.config.configType': 1,
              'tiles.config.displayType': 1,
            },
          ),
        ).lean(),
        bounded(
          Alert.find(
            { team: teamId },
            // dashboard/tileId are read only to resolve the tile's name below,
            // and stay out of the response — the import id is the alert's own.
            { name: 1, source: 1, savedSearch: 1, dashboard: 1, tileId: 1 },
          ),
        ).lean(),
        bounded(SavedSearch.find({ team: teamId }, { name: 1 })).lean(),
        bounded(Source.find({ team: teamId }, { name: 1, kind: 1 })).lean(),
        bounded(
          Connection.find(
            { team: teamId },
            { name: 1, platformProvisioned: 1 },
          ),
        ).lean(),
        bounded(Webhook.find({ team: teamId }, { name: 1 })).lean(),
      ]);

      const dashboards = capListing(dashboardRows);
      const alerts = capListing(alertRows);
      const savedSearches = capListing(savedSearchRows);
      const sources = capListing(sourceRows);
      const connections = capListing(connectionRows);
      const webhooks = capListing(webhookRows);

      const unaddressableTileAlerts = await unaddressableTileAlertIds({
        teamId,
        alerts: alerts.items,
        maxTimeMS: IAC_MANIFEST_MAX_TIME_MS,
      });

      const truncatedTypes = (
        [
          ['dashboards', dashboards.truncated],
          ['alerts', alerts.truncated],
          ['savedSearches', savedSearches.truncated],
          ['sources', sources.truncated],
          ['connections', connections.truncated],
          ['webhooks', webhooks.truncated],
        ] as const
      )
        .filter(([, truncated]) => truncated)
        .map(([key]) => key as string);

      // Ineligible resources are withheld silently from the caller's point of
      // view, so the count is the only operational signal that an export is
      // smaller than the team. Attributes are per-request detail; the counter
      // is what an alert can watch.
      const unexportableDashboards = dashboards.items.filter(d =>
        dashboardHasUnexportableTiles(d.tiles),
      ).length;
      const unexportableSources = sources.items.filter(
        s => !isImportableSource({ kind: s.kind }),
      ).length;

      span.setAttribute(
        'hyperdx.iac.import_manifest.truncated_types',
        truncatedTypes.join(','),
      );
      span.setAttribute(
        'hyperdx.iac.import_manifest.unexportable_dashboards',
        unexportableDashboards,
      );
      span.setAttribute(
        'hyperdx.iac.import_manifest.unexportable_sources',
        unexportableSources,
      );
      span.setAttribute(
        'hyperdx.iac.import_manifest.unaddressable_tile_alerts',
        unaddressableTileAlerts.size,
      );
      if (truncatedTypes.length > 0) {
        manifestTruncations.add(1);
      }
      if (unexportableDashboards > 0) {
        manifestUnexportableDashboards.add(unexportableDashboards);
      }
      if (unexportableSources > 0) {
        manifestUnexportableSources.add(unexportableSources);
      }
      if (unaddressableTileAlerts.size > 0) {
        manifestUnaddressableTileAlerts.add(unaddressableTileAlerts.size);
      }

      // `name` is `?? undefined` on every listing, not just alerts: these are
      // plain non-required Strings in Mongoose, so a stored null is legal, and
      // the wire contract is `.optional()` which rejects null. One null name
      // would fail the client's all-or-nothing parse for the whole manifest.
      const body: IacImportManifest = {
        dashboards: dashboards.items.map(d => ({
          id: d._id.toString(),
          name: d.name ?? undefined,
          // Omitted rather than `false` when fine, so the wire stays lean and
          // the field reads as a marker rather than a tri-state.
          ...(dashboardHasUnexportableTiles(d.tiles)
            ? { unexportableTiles: true }
            : {}),
        })),
        alerts: alerts.items.map(a => ({
          id: a._id.toString(),
          name: a.name ?? undefined,
          source: a.source,
          savedSearchId: a.savedSearch?.toString(),
          // Omitted rather than `false` when fine, like the dashboards leg.
          ...(unaddressableTileAlerts.has(a._id.toString())
            ? { unaddressableTile: true }
            : {}),
        })),
        savedSearches: savedSearches.items.map(s => ({
          id: s._id.toString(),
          name: s.name ?? undefined,
        })),
        sources: sources.items.map(s => ({
          id: s._id.toString(),
          name: s.name ?? undefined,
          kind: s.kind,
        })),
        connections: connections.items.map(c => ({
          id: c._id.toString(),
          name: c.name ?? undefined,
          // Passed through verbatim, including undefined — the export
          // distinguishes "unknown" from an explicit false.
          platformProvisioned: c.platformProvisioned,
        })),
        webhooks: webhooks.items.map(w => ({
          id: w._id.toString(),
          name: w.name ?? undefined,
        })),
        truncatedTypes,
      };
      return body;
    });

    return res.json(manifest);
  } catch (e) {
    next(e);
  }
});

export default router;
