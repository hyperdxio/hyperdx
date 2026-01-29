import express, { Express } from 'express';
import request from 'supertest';
import { z } from 'zod';

import { validateRequestWithEnhancedErrors as validateRequest } from '../enhancedErrors';
import {
  alertSchema,
  externalChartSchema,
  externalQueryChartSeriesSchema,
  objectIdSchema,
  tagsSchema,
} from '../zod';

describe('enhancedErrors', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  describe('validateRequestWithEnhancedErrors', () => {
    it('should report validation errors for dashboard with invalid chart', async () => {
      app.post(
        '/dashboards',
        validateRequest({
          body: z.object({
            name: z.string().max(1024),
            tiles: z.array(externalChartSchema),
            tags: tagsSchema,
          }),
        }),
        (_, res) => res.json({ success: true }),
      );

      const response = await request(app)
        .post('/dashboards')
        .send({
          name: 'Test Dashboard',
          tiles: [
            {
              name: 'Invalid Chart',
              x: 0,
              y: 0,
              w: 'not-a-number', // Invalid: should be number
              h: 3,
              series: [],
            },
          ],
          tags: ['test'],
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toEqual(
        'Body validation failed: tiles.0.w: Expected number, received string',
      );
    });

    it('should validate chart series query with chart series schema', async () => {
      const millisecondTimestampSchema = z
        .number()
        .int({ message: 'Timestamp must be an integer' })
        .positive({ message: 'Timestamp must be positive' })
        .refine(val => val.toString().length >= 13, {
          message: 'Timestamp must be in milliseconds',
        });

      app.post(
        '/charts/series',
        validateRequest({
          body: z.object({
            series: z.array(externalQueryChartSeriesSchema).min(1).max(5),
            startTime: millisecondTimestampSchema,
            endTime: millisecondTimestampSchema,
            granularity: z.enum(['30s', '1m', '5m', '1h']).optional(),
          }),
        }),
        (_, res) => res.json({ success: true }),
      );

      const response = await request(app)
        .post('/charts/series')
        .send({
          series: [
            {
              sourceId: '507f1f77bcf86cd799439011',
              aggFn: 'count',
              where: 'level:error',
              groupBy: [],
            },
          ],
          startTime: 1647014400000,
          endTime: 1647100800000,
          granularity: '1h',
        });

      expect(response.status).toBe(200);
    });

    it('should report validation errors for invalid timestamps in chart query', async () => {
      const millisecondTimestampSchema = z
        .number()
        .int({ message: 'Timestamp must be an integer' })
        .positive({ message: 'Timestamp must be positive' })
        .refine(val => val.toString().length >= 13, {
          message: 'Timestamp must be in milliseconds',
        });

      app.post(
        '/charts/series',
        validateRequest({
          body: z.object({
            series: z.array(externalQueryChartSeriesSchema).min(1).max(5),
            startTime: millisecondTimestampSchema,
            endTime: millisecondTimestampSchema,
          }),
        }),
        (_, res) => res.json({ success: true }),
      );

      const response = await request(app)
        .post('/charts/series')
        .send({
          series: [
            {
              sourceId: '507f1f77bcf86cd799439011',
              aggFn: 'count',
              where: 'level:error',
              groupBy: [],
            },
          ],
          startTime: 1647014, // Too short - not in milliseconds
          endTime: 1647100800000,
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toEqual(
        'Body validation failed: startTime: Timestamp must be in milliseconds',
      );
    });

    it('should report validation errors for invalid alert configuration', async () => {
      app.put(
        '/alerts/:id',
        validateRequest({
          params: z.object({ id: objectIdSchema }),
          body: alertSchema,
        }),
        (_, res) => res.json({ success: true }),
      );

      const response = await request(app)
        .put('/alerts/not-a-valid-id')
        .send({
          source: 'tile',
          tileId: '507f1f77bcf86cd799439011',
          dashboardId: '507f1f77bcf86cd799439011',
          threshold: -5, // Invalid: negative threshold
          interval: '99m', // Invalid: not a valid interval
          thresholdType: 'above',
          channel: {
            type: 'webhook',
            webhookId: '507f1f77bcf86cd799439011',
          },
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toEqual(
        "Body validation failed: interval: Invalid enum value. Expected '1m' | '5m' | '15m' | '30m' | '1h' | '6h' | '12h' | '1d', received '99m'; threshold: Number must be greater than or equal to 0; Params validation failed: id: Invalid input",
      );
    });
  });
});
