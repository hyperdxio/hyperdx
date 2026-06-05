import {
  DashboardSchema,
  DashboardWithoutIdSchema,
  PresetDashboard,
  PresetDashboardFilterSchema,
  resolveChartPaletteToken,
  walkRawDashboardTileColors,
} from '@hyperdx/common-utils/dist/types';
import express from 'express';
import _ from 'lodash';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  createDashboard,
  deleteDashboard,
  getDashboard,
  getDashboards,
  updateDashboard,
} from '@/controllers/dashboard';
import {
  createPresetDashboardFilter,
  deletePresetDashboardFilter,
  getPresetDashboardFilters,
  updatePresetDashboardFilter,
} from '@/controllers/presetDashboardFilters';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import logger from '@/utils/logger';
import { objectIdSchema } from '@/utils/zod';

// create routes that will get and update dashboards
const router = express.Router();

/**
 * Heal legacy `chart-1`..`chart-10` tile colors from #2265 on the request
 * body *before* `validateRequest` runs `ChartPaletteTokenSchema`. Keeps the
 * schema strict (so `z.input` == `z.output` and `req.body` infers cleanly)
 * while still accepting payloads from any non-React HTTP client whose
 * stored values haven't yet been healed by the app-side normalizer
 * (`normalizeDashboardTileColors` in `packages/app/src/dashboard.ts`).
 *
 * This is a one-release deprecation shim — once stored data has converged
 * on the hue-named tokens, it can be removed in favor of straight-strict
 * validation. The actual walk delegates to `walkRawDashboardTileColors`
 * in common-utils so this middleware, the app-side normalizer, the JSON
 * import path, and the provisioner all share the same per-tile traversal.
 */
const migrateLegacyDashboardTileColors: express.RequestHandler = (
  req,
  _res,
  next,
) => {
  req.body = walkRawDashboardTileColors(req.body, current => {
    const resolved = resolveChartPaletteToken(current);
    return resolved ?? current;
  });
  next();
};

router.get('/', async (req, res, next) => {
  try {
    const { teamId } = getNonNullUserWithTeam(req);

    const dashboards = await getDashboards(teamId);

    return res.json(dashboards);
  } catch (e) {
    next(e);
  }
});

router.post(
  '/',
  migrateLegacyDashboardTileColors,
  validateRequest({
    body: DashboardWithoutIdSchema,
  }),
  async (req, res, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);

      const dashboard = req.body;

      const newDashboard = await createDashboard(teamId, dashboard, userId);

      res.json(newDashboard.toJSON());
    } catch (e) {
      next(e);
    }
  },
);

router.patch(
  '/:id',
  migrateLegacyDashboardTileColors,
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    body: DashboardSchema.partial(),
  }),
  async (req, res, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);
      const { id: dashboardId } = req.params;

      const dashboard = await getDashboard(dashboardId, teamId);

      if (dashboard == null) {
        return res.sendStatus(404);
      }

      // Only omit undefined values, keep null (which signals field removal)
      const updates = _.omitBy(req.body, _.isUndefined);

      const updatedDashboard = await updateDashboard(
        dashboardId,
        teamId,
        updates,
        userId,
      );

      res.json(updatedDashboard);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id',
  validateRequest({
    params: z.object({ id: objectIdSchema }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { id: dashboardId } = req.params;

      await deleteDashboard(dashboardId, teamId);

      res.sendStatus(204);
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/preset/:presetDashboard/filters',
  validateRequest({
    params: z.object({
      presetDashboard: z.nativeEnum(PresetDashboard),
    }),
    query: z.object({
      sourceId: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { presetDashboard } = req.params;
      const { sourceId } = req.query;

      const filters = await getPresetDashboardFilters(
        teamId,
        sourceId,
        presetDashboard,
      );

      return res.json(filters);
    } catch (e) {
      next(e);
    }
  },
);

router.put(
  '/preset/:presetDashboard/filter',
  validateRequest({
    body: z.object({
      filter: PresetDashboardFilterSchema,
    }),
    params: z.object({
      presetDashboard: z.nativeEnum(PresetDashboard),
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { filter } = req.body;

      if (filter.presetDashboard !== req.params.presetDashboard) {
        return res
          .status(400)
          .json({ error: 'Preset dashboard in body and params do not match' });
      }

      const updatedPresetDashboardFilter = await updatePresetDashboardFilter(
        teamId,
        filter,
      );

      if (!updatedPresetDashboardFilter) {
        return res.status(404).send();
      }

      return res.json(updatedPresetDashboardFilter);
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/preset/:presetDashboard/filter',
  validateRequest({
    body: z.object({
      filter: PresetDashboardFilterSchema,
    }),
    params: z.object({
      presetDashboard: z.nativeEnum(PresetDashboard),
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { filter } = req.body;

      if (filter.presetDashboard !== req.params.presetDashboard) {
        return res
          .status(400)
          .json({ error: 'Preset dashboard in body and params do not match' });
      }

      const newPresetDashboardFilter = await createPresetDashboardFilter(
        teamId,
        filter,
      );

      return res.json(newPresetDashboardFilter);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/preset/:presetDashboard/filter/:id',
  validateRequest({
    params: z.object({
      presetDashboard: z.nativeEnum(PresetDashboard),
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { presetDashboard, id } = req.params;

      const deleted = await deletePresetDashboardFilter(
        teamId,
        presetDashboard,
        id,
      );

      if (!deleted) {
        return res.status(404).send();
      }

      return res.json(deleted);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
