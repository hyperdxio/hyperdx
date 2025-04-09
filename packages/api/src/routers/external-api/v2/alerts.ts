import opentelemetry, { SpanStatusCode } from '@opentelemetry/api';
import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  createAlert,
  deleteAlert,
  getAlertById,
  getAlerts,
  updateAlert,
} from '@/controllers/alerts';
import { getTeam } from '@/controllers/team';
import { ObjectId } from '@/models';
import Alert, { AlertChannel } from '@/models/alert';

// Define Zod schemas for v2 API based on OpenAPI spec
const objectIdSchema = z
  .string()
  .refine(value => mongoose.Types.ObjectId.isValid(value), {
    message: 'Invalid ObjectId format',
  });

// Alert channel config schemas
const slackChannelConfigSchema = z.object({
  channel: z.string(),
  url: z.string().url(),
});

const webhookChannelConfigSchema = z.object({
  url: z.string().url(),
});

const emailChannelConfigSchema = z.object({
  emails: z.array(z.string().email()),
});

const pagerdutyChannelConfigSchema = z.object({
  routingKey: z.string(),
});

// Main alert schemas
const createAlertPayloadSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  query: z.string(),
  threshold: z.number().optional(),
  type: z.enum(['THRESHOLD', 'PRESENCE', 'ABSENCE']),
  channelType: z.enum(['SLACK', 'WEBHOOK', 'EMAIL', 'PAGERDUTY']),
  channelConfig: z.union([
    slackChannelConfigSchema,
    webhookChannelConfigSchema,
    emailChannelConfigSchema,
    pagerdutyChannelConfigSchema,
  ]),
  frequency: z.number().int().positive(),
  window: z.number().int().positive(),
  severity: z.enum(['INFO', 'WARNING', 'ERROR', 'CRITICAL']),
});

const updateAlertPayloadSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  query: z.string(),
  threshold: z.number().optional(),
  type: z.enum(['THRESHOLD', 'PRESENCE', 'ABSENCE']),
  channelType: z.enum(['SLACK', 'WEBHOOK', 'EMAIL', 'PAGERDUTY']),
  channelConfig: z.union([
    slackChannelConfigSchema,
    webhookChannelConfigSchema,
    emailChannelConfigSchema,
    pagerdutyChannelConfigSchema,
  ]),
  frequency: z.number().int().positive(),
  window: z.number().int().positive(),
  severity: z.enum(['INFO', 'WARNING', 'ERROR', 'CRITICAL']),
  silencedUntil: z.string().datetime().nullable().optional(),
});

// Helper function to map external API alert format to internal model
function mapExternalAlertToInternal(
  externalAlert: z.infer<typeof createAlertPayloadSchema>,
) {
  // Map channelType and channelConfig to the expected internal format
  let channel: AlertChannel;

  if (externalAlert.channelType === 'WEBHOOK') {
    // Type assertion to access the url property
    const webhookConfig = externalAlert.channelConfig as { url: string };
    channel = {
      type: 'webhook',
      webhookId: webhookConfig.url,
    };
  } else {
    // Handle other channel types or use null as default
    channel = { type: null };
  }

  return {
    name: externalAlert.name,
    message: externalAlert.description,
    channel,
    interval: mapFrequencyToInterval(externalAlert.frequency),
    threshold: externalAlert.threshold || 0,
    thresholdType: mapAlertTypeToThresholdType(externalAlert.type),
    query: externalAlert.query,
    // Map other fields as needed
  };
}

// Helper function to map frequency to interval format
function mapFrequencyToInterval(frequency: number): string {
  // Convert frequency in seconds to the expected interval format
  if (frequency <= 60) return '1m';
  if (frequency <= 300) return '5m';
  if (frequency <= 900) return '15m';
  if (frequency <= 1800) return '30m';
  if (frequency <= 3600) return '1h';
  if (frequency <= 21600) return '6h';
  if (frequency <= 43200) return '12h';
  return '1d';
}

// Helper function to map alert type to threshold type
function mapAlertTypeToThresholdType(type: string) {
  if (type === 'THRESHOLD') return 'above';
  return 'above'; // Default
}

// Helper function to map internal model to external API format
function mapInternalAlertToExternal(alert: any) {
  if (!alert) return null;

  // Map internal alert model to the expected API response format
  return {
    _id: alert._id.toString(),
    name: alert.name || '',
    description: alert.message || null,
    query: alert.query || '',
    threshold: alert.threshold,
    type: alert.thresholdType === 'below' ? 'BELOW' : 'THRESHOLD',
    channelType: alert.channel?.type === 'webhook' ? 'WEBHOOK' : 'EMAIL',
    channelConfig: mapChannelConfigToExternal(alert.channel),
    frequency: mapIntervalToFrequency(alert.interval),
    window: alert.window || 60,
    lastTriggeredAt: alert.updatedAt,
    createdAt: alert.createdAt,
    updatedAt: alert.updatedAt,
    silencedUntil: alert.silenced?.until || null,
    state: mapInternalStateToExternal(alert.state),
    severity: alert.severity || 'INFO',
  };
}

// Helper function to map internal channel config to external format
function mapChannelConfigToExternal(channel: any) {
  if (!channel) return {};

  if (channel.type === 'webhook') {
    return { url: channel.webhookId };
  }

  return {};
}

// Helper function to map interval to frequency in seconds
function mapIntervalToFrequency(interval: string): number {
  switch (interval) {
    case '1m':
      return 60;
    case '5m':
      return 300;
    case '15m':
      return 900;
    case '30m':
      return 1800;
    case '1h':
      return 3600;
    case '6h':
      return 21600;
    case '12h':
      return 43200;
    case '1d':
      return 86400;
    default:
      return 60;
  }
}

// Helper function to map internal state to external API state
function mapInternalStateToExternal(state: string): string {
  switch (state) {
    case 'ALERT':
      return 'ALERT';
    case 'DISABLED':
      return 'ERROR';
    case 'INSUFFICIENT_DATA':
      return 'NO_DATA';
    case 'OK':
      return 'OK';
    default:
      return 'OK';
  }
}

// Controller functions for v2
async function listAlertsV2(teamId: string) {
  try {
    const mongoTeamId = new mongoose.Types.ObjectId(teamId);
    const alerts = await getAlerts(mongoTeamId);

    // Map internal alert model to external API format
    return alerts.map(alert => mapInternalAlertToExternal(alert));
  } catch (error) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(error as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  }
}

async function createAlertV2(
  teamId: string,
  alertData: z.infer<typeof createAlertPayloadSchema>,
) {
  try {
    const internalAlert = mapExternalAlertToInternal(alertData);
    const mongoTeamId = new mongoose.Types.ObjectId(teamId);

    // Create the alert using the internal controller
    const newAlert = await createAlert(mongoTeamId, internalAlert as any);

    // Map back to external API format
    return mapInternalAlertToExternal(newAlert);
  } catch (error) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(error as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  }
}

async function getAlertByIdV2(alertId: string, teamId: string) {
  try {
    // getAlertById accepts string or ObjectId types
    const alert = await getAlertById(alertId, teamId);

    if (!alert) {
      return null;
    }

    // Map to external API format
    return mapInternalAlertToExternal(alert);
  } catch (error) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(error as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  }
}

async function updateAlertV2(
  alertId: string,
  teamId: string,
  updateData: z.infer<typeof updateAlertPayloadSchema>,
) {
  try {
    // getAlertById accepts string or ObjectId types
    const existingAlert = await getAlertById(alertId, teamId);

    if (!existingAlert) {
      return null;
    }

    const internalUpdateData = mapExternalAlertToInternal(updateData);

    // updateAlert requires ObjectId for teamId
    const mongoTeamId = new mongoose.Types.ObjectId(teamId);
    const updatedAlert = await updateAlert(
      alertId,
      mongoTeamId,
      internalUpdateData as any,
    );

    if (!updatedAlert) {
      throw new Error('Failed to update alert');
    }

    // Map to external API format
    return mapInternalAlertToExternal(updatedAlert);
  } catch (error) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(error as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  }
}

async function deleteAlertV2(alertId: string, teamId: string) {
  try {
    // deleteAlert requires ObjectId for teamId
    const mongoTeamId = new mongoose.Types.ObjectId(teamId);
    await deleteAlert(alertId, mongoTeamId);
    return true;
  } catch (error) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(error as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  }
}

const router = express.Router();

// GET /alerts
router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (!teamId) {
      return res.sendStatus(403);
    }

    const alerts = await listAlertsV2(teamId.toString());
    return res.json(alerts);
  } catch (e) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(e as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
    next(e);
  }
});

// POST /alerts
router.post(
  '/',
  validateRequest({ body: createAlertPayloadSchema }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (!teamId) {
        return res.sendStatus(403);
      }

      const newAlert = await createAlertV2(teamId.toString(), req.body);
      return res.status(201).json(newAlert);
    } catch (e) {
      const span = opentelemetry.trace.getActiveSpan();
      span?.recordException(e as Error);
      span?.setStatus({ code: SpanStatusCode.ERROR });
      next(e);
    }
  },
);

// GET /alerts/{alertId}
router.get(
  '/:alertId',
  validateRequest({ params: z.object({ alertId: objectIdSchema }) }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (!teamId) {
        return res.sendStatus(403);
      }

      const { alertId } = req.params;
      const alert = await getAlertByIdV2(alertId, teamId.toString());

      if (!alert) {
        return res.sendStatus(404);
      }

      return res.json(alert);
    } catch (e) {
      const span = opentelemetry.trace.getActiveSpan();
      span?.recordException(e as Error);
      span?.setStatus({ code: SpanStatusCode.ERROR });
      next(e);
    }
  },
);

// PUT /alerts/{alertId}
router.put(
  '/:alertId',
  validateRequest({
    params: z.object({ alertId: objectIdSchema }),
    body: updateAlertPayloadSchema,
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (!teamId) {
        return res.sendStatus(403);
      }

      const { alertId } = req.params;
      const updatedAlert = await updateAlertV2(
        alertId,
        teamId.toString(),
        req.body,
      );

      if (!updatedAlert) {
        return res.sendStatus(404);
      }

      return res.json(updatedAlert);
    } catch (e) {
      const span = opentelemetry.trace.getActiveSpan();
      span?.recordException(e as Error);
      span?.setStatus({ code: SpanStatusCode.ERROR });
      next(e);
    }
  },
);

// DELETE /alerts/{alertId}
router.delete(
  '/:alertId',
  validateRequest({ params: z.object({ alertId: objectIdSchema }) }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (!teamId) {
        return res.sendStatus(403);
      }

      const { alertId } = req.params;
      const success = await deleteAlertV2(alertId, teamId.toString());

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
