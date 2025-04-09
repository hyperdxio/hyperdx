import { DisplayType } from '@hyperdx/common-utils/dist/types';
import opentelemetry, { SpanStatusCode } from '@opentelemetry/api';
import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  createDashboard,
  deleteDashboard,
  getDashboard,
  getDashboards,
  updateDashboard,
} from '@/controllers/dashboard';
import { ObjectId } from '@/models';
import Dashboard from '@/models/dashboard';

// Define Zod schemas for v2 API based on OpenAPI spec
const objectIdSchema = z
  .string()
  .refine(value => mongoose.Types.ObjectId.isValid(value), {
    message: 'Invalid ObjectId format',
  });

// Define schemas for dashboard tiles
const tileSchema = z.object({
  id: z.string(),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  config: z
    .object({
      name: z.string(),
      source: z.string(),
      displayType: z.string().optional(),
      // Other chart config fields as needed
    })
    .passthrough(), // Allow other properties in config
});

// Main dashboard schemas
const createDashboardPayloadSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  tiles: z.array(tileSchema).default([]),
});

const updateDashboardPayloadSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()),
  tiles: z.array(tileSchema),
});

// Helper function to map external API dashboard format to internal model
function mapExternalDashboardToInternal(
  externalDashboard: z.infer<typeof createDashboardPayloadSchema>,
) {
  // Return with type assertion to avoid complex type issues
  return {
    name: externalDashboard.name,
    tags: externalDashboard.tags || [],
    tiles: externalDashboard.tiles || [],
    description: externalDashboard.description,
  } as any; // Use type assertion for now to satisfy TypeScript
}

// Helper function to map internal model to external API format
function mapInternalDashboardToExternal(dashboard: any) {
  if (!dashboard) return null;

  // Convert MongoDB _id to string
  return {
    _id: dashboard._id.toString(),
    name: dashboard.name,
    description: dashboard.description || null,
    tags: dashboard.tags || [],
    tiles: dashboard.tiles || [],
    createdAt: dashboard.createdAt,
    updatedAt: dashboard.updatedAt,
  };
}

// Controller functions for v2
async function listDashboardsV2(teamId: string) {
  try {
    const mongoTeamId = new mongoose.Types.ObjectId(teamId);
    const dashboards = await getDashboards(mongoTeamId);

    // Map internal dashboard model to external API format
    return dashboards.map(dashboard =>
      mapInternalDashboardToExternal(dashboard),
    );
  } catch (error) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(error as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  }
}

async function createDashboardV2(
  teamId: string,
  dashboardData: z.infer<typeof createDashboardPayloadSchema>,
) {
  try {
    const internalDashboard = mapExternalDashboardToInternal(dashboardData);
    const mongoTeamId = new mongoose.Types.ObjectId(teamId);

    // Create the dashboard using the internal controller
    const newDashboard = await createDashboard(mongoTeamId, internalDashboard);

    // Map back to external API format
    return mapInternalDashboardToExternal(newDashboard);
  } catch (error) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(error as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  }
}

async function getDashboardByIdV2(dashboardId: string, teamId: string) {
  try {
    const mongoTeamId = new mongoose.Types.ObjectId(teamId);
    const dashboard = await getDashboard(dashboardId, mongoTeamId);

    if (!dashboard) {
      return null;
    }

    // Map to external API format
    return mapInternalDashboardToExternal(dashboard);
  } catch (error) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(error as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  }
}

async function updateDashboardV2(
  dashboardId: string,
  teamId: string,
  updateData: z.infer<typeof updateDashboardPayloadSchema>,
) {
  try {
    const mongoTeamId = new mongoose.Types.ObjectId(teamId);

    // Check if dashboard exists
    const existingDashboard = await getDashboard(dashboardId, mongoTeamId);
    if (!existingDashboard) {
      return null;
    }

    const internalUpdateData = mapExternalDashboardToInternal(updateData);
    const updatedDashboard = await updateDashboard(
      dashboardId,
      mongoTeamId,
      internalUpdateData,
    );

    // Map to external API format
    return mapInternalDashboardToExternal(updatedDashboard);
  } catch (error) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(error as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  }
}

async function deleteDashboardV2(dashboardId: string, teamId: string) {
  try {
    const mongoTeamId = new mongoose.Types.ObjectId(teamId);
    await deleteDashboard(dashboardId, mongoTeamId);
    return true;
  } catch (error) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(error as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  }
}

const router = express.Router();

// GET /dashboards
router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (!teamId) {
      return res.sendStatus(403);
    }

    const dashboards = await listDashboardsV2(teamId.toString());
    return res.json(dashboards);
  } catch (e) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(e as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
    next(e);
  }
});

// POST /dashboards
router.post(
  '/',
  validateRequest({ body: createDashboardPayloadSchema }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (!teamId) {
        return res.sendStatus(403);
      }

      const dashboardData = {
        ...req.body,
        tags: req.body.tags || [],
        tiles: req.body.tiles || [],
      };

      const newDashboard = await createDashboardV2(
        teamId.toString(),
        dashboardData,
      );
      return res.status(201).json(newDashboard);
    } catch (e) {
      const span = opentelemetry.trace.getActiveSpan();
      span?.recordException(e as Error);
      span?.setStatus({ code: SpanStatusCode.ERROR });
      next(e);
    }
  },
);

// GET /dashboards/{dashboardId}
router.get(
  '/:dashboardId',
  validateRequest({ params: z.object({ dashboardId: objectIdSchema }) }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (!teamId) {
        return res.sendStatus(403);
      }

      const { dashboardId } = req.params;
      const dashboard = await getDashboardByIdV2(
        dashboardId,
        teamId.toString(),
      );

      if (!dashboard) {
        return res.sendStatus(404);
      }

      return res.json(dashboard);
    } catch (e) {
      const span = opentelemetry.trace.getActiveSpan();
      span?.recordException(e as Error);
      span?.setStatus({ code: SpanStatusCode.ERROR });
      next(e);
    }
  },
);

// PUT /dashboards/{dashboardId}
router.put(
  '/:dashboardId',
  validateRequest({
    params: z.object({ dashboardId: objectIdSchema }),
    body: updateDashboardPayloadSchema,
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (!teamId) {
        return res.sendStatus(403);
      }

      const { dashboardId } = req.params;
      const updatedDashboard = await updateDashboardV2(
        dashboardId,
        teamId.toString(),
        req.body,
      );

      if (!updatedDashboard) {
        return res.sendStatus(404);
      }

      return res.json(updatedDashboard);
    } catch (e) {
      const span = opentelemetry.trace.getActiveSpan();
      span?.recordException(e as Error);
      span?.setStatus({ code: SpanStatusCode.ERROR });
      next(e);
    }
  },
);

// DELETE /dashboards/{dashboardId}
router.delete(
  '/:dashboardId',
  validateRequest({ params: z.object({ dashboardId: objectIdSchema }) }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (!teamId) {
        return res.sendStatus(403);
      }

      const { dashboardId } = req.params;
      const success = await deleteDashboardV2(dashboardId, teamId.toString());

      if (!success) {
        return res.sendStatus(404);
      }

      return res.sendStatus(204);
    } catch (e) {
      const span = opentelemetry.trace.getActiveSpan();
      span?.recordException(e as Error);
      span?.setStatus({ code: SpanStatusCode.ERROR });
      next(e);
    }
  },
);

export default router;
