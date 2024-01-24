import express from 'express';
import { uniq } from 'lodash';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  deleteDashboardAndAlerts,
  updateDashboard,
  updateDashboardAndAlerts,
} from '@/controllers/dashboard';
import Dashboard, { IDashboard } from '@/models/dashboard';
import {
  chartSchema,
  externalChartSchema,
  externalChartSchemaWithId,
  histogramChartSeriesSchema,
  markdownChartSeriesSchema,
  numberChartSeriesSchema,
  objectIdSchema,
  searchChartSeriesSchema,
  tableChartSeriesSchema,
  tagsSchema,
  timeChartSeriesSchema,
} from '@/utils/zod';

const router = express.Router();

function translateExternalChartToInternalChart(
  chartInput: z.infer<typeof externalChartSchemaWithId>,
): z.infer<typeof chartSchema> {
  const { id, x, name, y, w, h, series, asRatio } = chartInput;
  return {
    id,
    name,
    x,
    y,
    w,
    h,
    seriesReturnType: asRatio ? 'ratio' : 'column',
    series: series.map(s => {
      const {
        type,
        data_source,
        aggFn,
        field,
        fields,
        where,
        groupBy,
        sortOrder,
        content,
        numberFormat,
        metricDataType,
      } = s;

      const table = data_source === 'metrics' ? 'metrics' : 'logs';

      if (type === 'time') {
        if (aggFn == null) {
          throw new Error('aggFn must be set for time chart');
        }

        const series: z.infer<typeof timeChartSeriesSchema> = {
          type: 'time',
          table,
          aggFn,
          where: where ?? '',
          groupBy: groupBy ?? [],
          ...(field ? { field } : {}),
          ...(numberFormat ? { numberFormat } : {}),
          ...(metricDataType ? { metricDataType } : {}),
        };

        return series;
      } else if (type === 'table') {
        if (aggFn == null) {
          throw new Error('aggFn must be set for table chart');
        }

        const series: z.infer<typeof tableChartSeriesSchema> = {
          type: 'table',
          table,
          aggFn,
          where: where ?? '',
          groupBy: groupBy ?? [],
          sortOrder: sortOrder ?? 'desc',
          ...(field ? { field } : {}),
          ...(numberFormat ? { numberFormat } : {}),
          ...(metricDataType ? { metricDataType } : {}),
        };

        return series;
      } else if (type === 'number') {
        if (aggFn == null) {
          throw new Error('aggFn must be set for number chart');
        }

        const series: z.infer<typeof numberChartSeriesSchema> = {
          type: 'number',
          table,
          aggFn,
          where: where ?? '',
          ...(field ? { field } : {}),
          ...(numberFormat ? { numberFormat } : {}),
          ...(metricDataType ? { metricDataType } : {}),
        };

        return series;
      } else if (type === 'histogram') {
        const series: z.infer<typeof histogramChartSeriesSchema> = {
          type: 'histogram',
          table,
          where: where ?? '',
          ...(field ? { field } : {}),
          ...(metricDataType ? { metricDataType } : {}),
        };

        return series;
      } else if (type === 'search') {
        const series: z.infer<typeof searchChartSeriesSchema> = {
          type: 'search',
          fields: fields ?? [],
          where: where ?? '',
        };

        return series;
      } else if (type === 'markdown') {
        const series: z.infer<typeof markdownChartSeriesSchema> = {
          type: 'markdown',
          content: content ?? '',
        };

        return series;
      }

      throw new Error(`Invalid chart type ${type}`);
    }),
  };
}

const translateChartDocumentToExternalChart = (
  chart: z.infer<typeof chartSchema>,
): z.infer<typeof externalChartSchemaWithId> => {
  const { id, x, name, y, w, h, series, seriesReturnType } = chart;
  return {
    id,
    name,
    x,
    y,
    w,
    h,
    asRatio: seriesReturnType === 'ratio',
    series: series.map(s => {
      const {
        type,
        table,
        aggFn,
        field,
        where,
        groupBy,
        sortOrder,
        content,
        numberFormat,
      } = s;

      return {
        type,
        data_source: table === 'metrics' ? 'metrics' : 'events',
        aggFn,
        field,
        where,
        groupBy,
        sortOrder,
        content,
        numberFormat,
      };
    }),
  };
};

const translateDashboardDocumentToExternalDashboard = (
  dashboard: IDashboard,
): {
  id: string;
  name: string;
  charts: z.infer<typeof externalChartSchemaWithId>[];
  query: string;
  tags: string[];
} => {
  const { _id, name, charts, query, tags } = dashboard;

  return {
    id: _id.toString(),
    name,
    charts: charts.map(translateChartDocumentToExternalChart),
    query,
    tags,
  };
};

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

      const dashboard = await Dashboard.findOne(
        { team: teamId, _id: req.params.id },
        { _id: 1, name: 1, charts: 1, query: 1 },
      );

      if (dashboard == null) {
        return res.sendStatus(404);
      }

      res.json({
        data: translateDashboardDocumentToExternalDashboard(dashboard),
      });
    } catch (e) {
      next(e);
    }
  },
);

router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }

    const dashboards = await Dashboard.find(
      { team: teamId },
      { _id: 1, name: 1, charts: 1, query: 1 },
    ).sort({ name: -1 });

    res.json({
      data: dashboards.map(d =>
        translateDashboardDocumentToExternalDashboard(d),
      ),
    });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/',
  validateRequest({
    body: z.object({
      name: z.string().max(1024),
      charts: z.array(externalChartSchema),
      query: z.string().max(2048),
      tags: tagsSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const { name, charts, query, tags } = req.body;

      const internalCharts = charts.map(chart => {
        const chartId = new ObjectId().toString();
        return translateExternalChartToInternalChart({
          id: chartId,
          ...chart,
        });
      });

      // Create new dashboard from name and charts
      const newDashboard = await new Dashboard({
        name,
        charts: internalCharts,
        query,
        tags: tags && uniq(tags),
        team: teamId,
      }).save();

      res.json({
        data: translateDashboardDocumentToExternalDashboard(newDashboard),
      });
    } catch (e) {
      next(e);
    }
  },
);

router.put(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    body: z.object({
      name: z.string().max(1024),
      charts: z.array(externalChartSchemaWithId),
      query: z.string().max(2048),
      tags: tagsSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const { id: dashboardId } = req.params;
      if (teamId == null) {
        return res.sendStatus(403);
      }
      if (!dashboardId) {
        return res.sendStatus(400);
      }

      const { name, charts, query, tags } = req.body ?? {};

      const internalCharts = charts.map(chart => {
        return translateExternalChartToInternalChart(chart);
      });

      const updatedDashboard = await updateDashboard(dashboardId, teamId, {
        name,
        charts: internalCharts,
        query,
        tags,
      });

      if (updatedDashboard == null) {
        return res.sendStatus(404);
      }

      res.json({
        data: translateDashboardDocumentToExternalDashboard(updatedDashboard),
      });
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const { id: dashboardId } = req.params;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      await deleteDashboardAndAlerts(dashboardId, teamId);

      res.json({});
    } catch (e) {
      next(e);
    }
  },
);

export default router;
