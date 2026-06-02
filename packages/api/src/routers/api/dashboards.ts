import {
  DashboardFilter,
  DashboardSchema,
  DashboardWithoutIdSchema,
  PresetDashboard,
  PresetDashboardFilterSchema,
  refineDashboardFilterCoherence,
  refineDashboardFiltersConstantSiblings,
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

// Apply the same dashboard-filter coherence refinements the
// external-API and MCP entry points run, but at the internal API's
// route boundary. The shared `DashboardSchema` is intentionally left
// as a plain `ZodObject` so the various `.omit()` / `.partial()` /
// `.extend()` chains (DashboardWithoutIdSchema, DashboardSchema.partial(),
// DashboardTemplateSchema) keep working; that means the cross-filter
// rules are not attached on the schema itself. Wrap the per-route
// body schemas here so a server-internal caller (or any non-MCP /
// non-external-API path) gets the same rejection surface for:
//   1. renderMode: 'readonly' | 'hidden' without constant: true
//   2. mixed `constant: true` + editable siblings on the same expression
//
// Per-filter coherence is checked via a tiny pass-through schema so
// `refineDashboardFilterCoherence` can run with its existing ctx
// signature (the helper writes `path: ['renderMode']`; the outer
// ctx prepends `['filters', i]` on issues raised through the inner
// parser).
const perFilterCoherenceSchema = z
  .object({
    constant: z.boolean().optional(),
    renderMode: z.enum(['editable', 'readonly', 'hidden']).optional(),
  })
  .passthrough()
  .superRefine(refineDashboardFilterCoherence);

const refineDashboardFilters = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((data, ctx) => {
    const candidate = data as { filters?: unknown };
    if (!Array.isArray(candidate.filters) || candidate.filters.length === 0) {
      return;
    }
    const filters = candidate.filters as DashboardFilter[];
    filters.forEach((f, i) => {
      const result = perFilterCoherenceSchema.safeParse(f);
      if (!result.success) {
        for (const issue of result.error.issues) {
          ctx.addIssue({
            ...issue,
            path: ['filters', i, ...issue.path],
          });
        }
      }
    });
    refineDashboardFiltersConstantSiblings(filters, ctx);
  });

const internalCreateDashboardBodySchema = refineDashboardFilters(
  DashboardWithoutIdSchema,
);
const internalUpdateDashboardBodySchema = refineDashboardFilters(
  DashboardSchema.partial(),
);

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
  validateRequest({
    body: internalCreateDashboardBodySchema,
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
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    body: internalUpdateDashboardBodySchema,
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
