import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';
import ms from 'ms';

import {
  createIncident,
  getIncidentById,
  getIncidents,
  updateIncident,
  addIncidentComment,
} from '@/controllers/incidents';
import { getAlertById } from '@/controllers/alerts';
import { analyzeIncident } from '@/utils/ai';
import { IncidentStatus, IncidentSeverity } from '@/models/incident';
import { objectIdSchema } from '@/utils/zod';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getConnectionById } from '@/controllers/connection';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import Alert, { AlertSource } from '@/models/alert';
import logger from '@/utils/logger';
import { getSource } from '@/controllers/sources';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

const router = express.Router();

const incidentSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.nativeEnum(IncidentStatus).optional(),
  severity: z.nativeEnum(IncidentSeverity).optional(),
  alertId: objectIdSchema.optional(),
  ownerId: objectIdSchema.optional(),
  resolutionNotes: z.string().optional(),
});

const updateIncidentSchema = incidentSchema.partial();

const commentSchema = z.object({
  message: z.string().min(1),
});

router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    const incidents = await getIncidents(teamId);
    res.json({ data: incidents });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/',
  validateRequest({ body: incidentSchema }),
  async (req, res, next) => {
    const teamId = req.user?.team;
    const user = req.user;
    if (teamId == null || user == null) {
      return res.sendStatus(403);
    }
    try {
      const incident = await createIncident(teamId, req.body, user);
      res.json({ data: incident });
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }
      const incident = await getIncidentById(req.params.id, teamId);
      if (!incident) {
        return res.sendStatus(404);
      }
      res.json({ data: incident });
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/:id/analyze',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    const teamId = req.user?.team;
    const user = req.user;
    if (teamId == null || user == null) {
      return res.sendStatus(403);
    }

    try {
      const incident = await getIncidentById(req.params.id, teamId);
      if (!incident) {
        return res.sendStatus(404);
      }

      let context = `Incident Title: ${incident.title}\nDescription: ${incident.description}\n`;

      // If linked to an alert, try to fetch recent logs/metrics
      if (incident.alert) {
        // We need to re-fetch the alert to get the full object (populate might not be enough depending on implementation)
        const alert = await Alert.findById(incident.alert._id).populate('savedSearch');
        
        if (alert && alert.source === AlertSource.SAVED_SEARCH && alert.savedSearch) {
           const savedSearch = alert.savedSearch as unknown as any; // Cast to any to avoid TS issues with populated fields not matching strict types
           context += `Triggered by Alert: ${alert.name}\n`;
           context += `Threshold: ${alert.thresholdType} ${alert.threshold}\n`;
           
           // Fetch recent logs
           try {
             // 1. Get Source and Connection
             const source = await getSource(teamId.toString(), savedSearch.source.toString());
             if (source) {
               const connection = await getConnectionById(teamId.toString(), source.connection.toString());
               if (connection) {
                 const clickhouseClient = new ClickhouseClient({
                   host: connection.host,
                   username: connection.username,
                   password: connection.password,
                 });

                 // 2. Build Query
                 // Query for data around the incident creation time
                 const now = incident.createdAt;
                 const windowSize = ms('15m'); // Look at 15m window
                 const dateRange: [Date, Date] = [
                   new Date(now.getTime() - windowSize),
                   new Date(now.getTime() + ms('5m')), // Allow some buffer for future-dated logs or latency
                 ];

                 const chartConfig: ChartConfigWithDateRange = {
                   connection: connection.id,
                   dateRange,
                   from: source.from,
                   select: savedSearch.select || '*',
                   where: savedSearch.where,
                   whereLanguage: savedSearch.whereLanguage,
                   groupBy: [], // Clear groupBy for raw logs
                   granularity: undefined, // Clear granularity for raw logs
                   timestampValueExpression: source.timestampValueExpression,
                   limit: { limit: 20 },
                   orderBy: [{
                     valueExpression: source.timestampValueExpression,
                     ordering: 'DESC',
                     aggFn: undefined,
                     aggCondition: '',
                     aggConditionLanguage: 'sql',
                     valueExpressionLanguage: 'sql',
                   }],
                 };

                 const metadata = getMetadata(clickhouseClient);
                 // We use queryChartConfig even for raw logs as it handles SQL generation and execution
                 const checksData = await clickhouseClient.queryChartConfig({
                   config: chartConfig,
                   metadata,
                 });
                 
                 context += `Recent Log/Metric Data: ${JSON.stringify(checksData.data)}\n`;

               }
             }
           } catch (fetchErr: any) {
             logger.error({ err: fetchErr }, 'Failed to fetch context data for AI analysis');
             context += `\n(Failed to fetch recent data: ${fetchErr.message})`;
           }
        }
      }
      
      const analysis = await analyzeIncident(context);

      // Post the analysis as a comment
      const updatedIncident = await addIncidentComment(
        incident.id,
        teamId,
        `**AI Analysis**:\n\n${analysis}`,
        user, // Or a dedicated "AI Bot" user if we had one
      );

      res.json({ data: updatedIncident });

    } catch (e) {
      next(e);
    }
  }
);

router.patch(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    body: updateIncidentSchema,
  }),
  async (req, res, next) => {
    const teamId = req.user?.team;
    const user = req.user;
    if (teamId == null || user == null) {
      return res.sendStatus(403);
    }
    try {
      const incident = await updateIncident(
        req.params.id,
        teamId,
        req.body,
        user,
      );
      res.json({ data: incident });
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/:id/comments',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    body: commentSchema,
  }),
  async (req, res, next) => {
    const teamId = req.user?.team;
    const user = req.user;
    if (teamId == null || user == null) {
      return res.sendStatus(403);
    }
    try {
      const incident = await addIncidentComment(
        req.params.id,
        teamId,
        req.body.message,
        user,
      );
      res.json({ data: incident });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
