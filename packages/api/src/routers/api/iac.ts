import {
  IAC_MANIFEST_LIMIT,
  type IacImportManifest,
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

// Bounds a find without touching its result type. Only limit/maxTimeMS are
// wrapped — both return the same Query — so `.lean()` stays on the concrete
// model. Typing the whole chain instead collapses Source's discriminated
// union into its first member.
const bounded = <T extends Query<unknown, unknown>>(query: T): T =>
  query.limit(IAC_MANIFEST_LIMIT + 1).maxTimeMS(IAC_MANIFEST_MAX_TIME_MS) as T;

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

// Lean id+name manifest for the "Export to Terraform" team-settings UI.
// Deliberately avoids the heavy /dashboards and /alerts listing endpoints,
// which populate references and load full tile configs.
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
        bounded(
          Dashboard.find(
            { team: teamId, provisioned: { $ne: true } },
            { name: 1 },
          ),
        ).lean(),
        bounded(
          Alert.find({ team: teamId }, { name: 1, source: 1, savedSearch: 1 }),
        ).lean(),
        bounded(SavedSearch.find({ team: teamId }, { name: 1 })).lean(),
        bounded(Source.find({ team: teamId }, { name: 1 })).lean(),
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

      span.setAttribute(
        'hyperdx.iac.import_manifest.truncated_types',
        truncatedTypes.join(','),
      );
      if (truncatedTypes.length > 0) {
        manifestTruncations.add(1);
      }

      const body: IacImportManifest = {
        dashboards: dashboards.items.map(d => ({
          id: d._id.toString(),
          name: d.name,
        })),
        alerts: alerts.items.map(a => ({
          id: a._id.toString(),
          // Alert.name is nullable in Mongoose (null clears it); the wire
          // contract declares `name?: string`, so normalise null away here.
          name: a.name ?? undefined,
          source: a.source,
          savedSearchId: a.savedSearch?.toString(),
        })),
        savedSearches: savedSearches.items.map(s => ({
          id: s._id.toString(),
          name: s.name,
        })),
        sources: sources.items.map(s => ({
          id: s._id.toString(),
          name: s.name,
        })),
        connections: connections.items.map(c => ({
          id: c._id.toString(),
          name: c.name,
          // Passed through verbatim, including undefined — the export
          // distinguishes "unknown" from an explicit false.
          platformProvisioned: c.platformProvisioned,
        })),
        webhooks: webhooks.items.map(w => ({
          id: w._id.toString(),
          name: w.name,
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
