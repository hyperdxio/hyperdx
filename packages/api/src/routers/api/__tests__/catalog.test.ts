/**
 * Unit-level tests for the Berg catalog discovery router.
 *
 * The Glue SDK is stubbed with `aws-sdk-client-mock`; an ad-hoc Express
 * app simulates auth so the router can be exercised in isolation.
 */

import {
  GetDatabasesCommand,
  GetTableCommand,
  GetTablesCommand,
  GlueClient as SdkGlueClient,
} from '@aws-sdk/client-glue';
import { mockClient } from 'aws-sdk-client-mock';
import express from 'express';
import { Types } from 'mongoose';
import request from 'supertest';

import { isUserAuthenticated } from '@/middleware/auth';
import { appErrorHandler } from '@/middleware/error';
import catalogRouter from '@/routers/api/catalog';

const sdk = mockClient(SdkGlueClient);

const setup = (opts: { authenticated: boolean } = { authenticated: true }) => {
  const app = express();
  app.use(express.json());

  if (opts.authenticated) {
    app.use((req, _res, next) => {
      (req as any).user = {
        _id: 'test-user',
        team: new Types.ObjectId(),
      };
      (req as any).isAuthenticated = () => true;
      next();
    });
  } else {
    app.use((req, _res, next) => {
      (req as any).isAuthenticated = () => false;
      next();
    });
  }

  app.use('/api/v1', isUserAuthenticated, catalogRouter);
  app.use(appErrorHandler);
  return app;
};

describe('catalog router', () => {
  beforeEach(() => {
    sdk.reset();
  });

  it('GET /api/v1/catalogs returns the default catalog', async () => {
    const app = setup();
    const r = await request(app).get('/api/v1/catalogs');
    expect(r.status).toBe(200);
    expect(r.body.catalogs).toEqual(['AwsDataCatalog']);
  });

  it('GET /api/v1/catalogs requires auth', async () => {
    const app = setup({ authenticated: false });
    const r = await request(app).get('/api/v1/catalogs');
    expect(r.status).toBe(401);
  });

  it('GET /api/v1/catalogs/:catalogId/databases proxies Glue', async () => {
    sdk.on(GetDatabasesCommand).resolves({
      DatabaseList: [{ Name: 'db1' }, { Name: 'db2' }],
    });

    const app = setup();
    const r = await request(app).get(
      '/api/v1/catalogs/AwsDataCatalog/databases',
    );
    expect(r.status).toBe(200);
    expect(r.body.databases).toEqual(['db1', 'db2']);
  });

  it('GET databases swallows AccessDenied on browse and returns empty list', async () => {
    sdk.on(GetDatabasesCommand).rejects(
      Object.assign(new Error('access denied'), {
        name: 'AccessDeniedException',
      }),
    );

    const app = setup();
    const r = await request(app).get(
      '/api/v1/catalogs/AwsDataCatalog/databases',
    );
    expect(r.status).toBe(200);
    expect(r.body.databases).toEqual([]);
  });

  it('GET tables returns format-detected summaries', async () => {
    sdk.on(GetTablesCommand).resolves({
      TableList: [
        {
          Name: 'iceberg_t',
          TableType: 'EXTERNAL_TABLE',
          Parameters: { table_type: 'ICEBERG' },
          StorageDescriptor: { SerdeInfo: {} },
        },
        {
          Name: 'parquet_t',
          TableType: 'EXTERNAL_TABLE',
          StorageDescriptor: {
            SerdeInfo: {
              SerializationLibrary:
                'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
            },
          },
        },
      ],
    });

    const app = setup();
    const r = await request(app).get(
      '/api/v1/catalogs/AwsDataCatalog/databases/db1/tables',
    );
    expect(r.status).toBe(200);
    expect(r.body.tables).toEqual([
      expect.objectContaining({ table: 'iceberg_t', format: 'iceberg' }),
      expect.objectContaining({ table: 'parquet_t', format: 'parquet' }),
    ]);
  });

  it('GET schema returns 404 on EntityNotFoundException', async () => {
    sdk.on(GetTableCommand).rejects(
      Object.assign(new Error('table x not found'), {
        name: 'EntityNotFoundException',
      }),
    );

    const app = setup();
    const r = await request(app).get(
      '/api/v1/catalogs/AwsDataCatalog/databases/db1/tables/missing/schema',
    );
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('not_found');
  });

  it('GET schema returns 403 on AccessDeniedException', async () => {
    sdk.on(GetTableCommand).rejects(
      Object.assign(new Error('access denied'), {
        name: 'AccessDeniedException',
      }),
    );

    const app = setup();
    const r = await request(app).get(
      '/api/v1/catalogs/AwsDataCatalog/databases/db1/tables/locked/schema',
    );
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('access_denied');
  });

  it('GET schema returns the parsed schema for a real table', async () => {
    sdk.on(GetTableCommand).resolves({
      Table: {
        Name: 'events',
        DatabaseName: 'db1',
        TableType: 'EXTERNAL_TABLE',
        StorageDescriptor: {
          Location: 's3://bucket/events',
          SerdeInfo: {
            SerializationLibrary:
              'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
          },
          Columns: [
            { Name: 'id', Type: 'bigint' },
            { Name: 'message', Type: 'varchar' },
          ],
        },
        PartitionKeys: [{ Name: 'dt', Type: 'date' }],
      },
    });

    const app = setup();
    const r = await request(app).get(
      '/api/v1/catalogs/AwsDataCatalog/databases/db1/tables/events/schema',
    );
    expect(r.status).toBe(200);
    expect(r.body.table).toBe('events');
    expect(r.body.format).toBe('parquet');
    expect(r.body.partitionKeys).toEqual(['dt']);
    expect(r.body.columns).toEqual([
      expect.objectContaining({ name: 'id', isPartition: false }),
      expect.objectContaining({ name: 'message', isPartition: false }),
      expect.objectContaining({ name: 'dt', isPartition: true }),
    ]);
  });
});
