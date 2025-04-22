import type { ResponseJSON, Row } from '@clickhouse/client';
import opentelemetry, { SpanStatusCode } from '@opentelemetry/api';
import express from 'express';
import { isNumber, omit, parseInt } from 'lodash';
import _ from 'lodash';
import ms from 'ms';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as clickhouse from '@/clickhouse';

const router = express.Router();

router.get('/databases', async (req, res, next) => {
  const rows = await clickhouse.client.query({
    query: 'SHOW DATABASES',
    format: 'JSON',
  });
  const jsonRows = await rows.json<
    ResponseJSON<{
      name: string;
    }>
  >();
  const dbs = jsonRows.data;
  res.json(dbs);
});

router.get(
  '/databases/:database/tables',
  validateRequest({
    params: z.object({
      database: z.string().max(1024),
    }),
  }),
  async (req, res, next) => {
    const rows = await clickhouse.client.query({
      query: 'SHOW TABLES FROM {database:Identifier}',
      format: 'JSON',
      query_params: {
        database: req.params.database,
      },
    });
    const jsonRows = await rows.json<
      ResponseJSON<{
        name: string;
      }>
    >();
    const tables = jsonRows.data;

    res.json(tables);
  },
);

router.get(
  '/databases/:database/tables/:table/columns',
  validateRequest({
    params: z.object({
      database: z.string().max(1024),
      table: z.string().max(1024),
    }),
  }),
  async (req, res, next) => {
    const jsonRows = await clickhouse.getColumns({
      database: req.params.database,
      table: req.params.table,
    });
    const columns = jsonRows.data;

    res.json(columns);
  },
);

// TODO: Testing endpoint
router.get(
  '/databases/:database/tables/:table/fields/:field/sql',
  validateRequest({
    params: z.object({
      database: z.string().max(1024),
      table: z.string().max(1024),
      field: z.string().max(1024),
    }),
  }),
  async (req, res, next) => {
    res.json(
      await clickhouse.buildColumnExpressionFromField({
        database: req.params.database,
        table: req.params.table,
        field: req.params.field,
        inferredSimpleType: 'string',
      }),
    );
  },
);

export default router;
