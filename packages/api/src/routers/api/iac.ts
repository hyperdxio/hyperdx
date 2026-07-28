import { IacImportManifest } from '@hyperdx/common-utils/dist/types';
import express from 'express';

import { getNonNullUserWithTeam } from '@/middleware/auth';
import Alert from '@/models/alert';
import Connection from '@/models/connection';
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';
import { Source } from '@/models/source';
import Webhook from '@/models/webhook';

const router = express.Router();

// Lean id+name manifest for the "Export to Terraform" team-settings UI.
// Deliberately avoids the heavy /dashboards and /alerts listing endpoints,
// which populate references and load full tile configs.
router.get('/import-manifest', async (req, res, next) => {
  try {
    const { teamId } = getNonNullUserWithTeam(req);

    const [dashboards, alerts, savedSearches, sources, connections, webhooks] =
      await Promise.all([
        // Provisioned dashboards are machine-managed (ProvisionDashboardsTask)
        // and would conflict with Terraform-managed state.
        Dashboard.find(
          { team: teamId, provisioned: { $ne: true } },
          { name: 1 },
        ).lean(),
        Alert.find(
          { team: teamId },
          { name: 1, source: 1, savedSearch: 1 },
        ).lean(),
        SavedSearch.find({ team: teamId }, { name: 1 }).lean(),
        Source.find({ team: teamId }, { name: 1 }).lean(),
        Connection.find(
          { team: teamId },
          { name: 1, platformProvisioned: 1 },
        ).lean(),
        Webhook.find({ team: teamId }, { name: 1 }).lean(),
      ]);

    const manifest: IacImportManifest = {
      dashboards: dashboards.map(d => ({ id: d._id.toString(), name: d.name })),
      alerts: alerts.map(a => ({
        id: a._id.toString(),
        // Alert.name is nullable in Mongoose (null clears it); the wire
        // contract declares `name?: string`, so normalise null away here.
        name: a.name ?? undefined,
        source: a.source,
        savedSearchId: a.savedSearch?.toString(),
      })),
      savedSearches: savedSearches.map(s => ({
        id: s._id.toString(),
        name: s.name,
      })),
      sources: sources.map(s => ({ id: s._id.toString(), name: s.name })),
      connections: connections.map(c => ({
        id: c._id.toString(),
        name: c.name,
        // Passed through verbatim, including undefined — the export
        // distinguishes "unknown" from an explicit false.
        platformProvisioned: c.platformProvisioned,
      })),
      webhooks: webhooks.map(w => ({ id: w._id.toString(), name: w.name })),
    };

    return res.json(manifest);
  } catch (e) {
    next(e);
  }
});

export default router;
