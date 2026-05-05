import {
  GetDatabasesCommand,
  GetTableCommand,
  GetTablesCommand,
  GlueClient as SdkGlueClient,
} from '@aws-sdk/client-glue';
import { mockClient } from 'aws-sdk-client-mock';

import { GlueCatalogClient } from '../glue';

const sdk = mockClient(SdkGlueClient);

beforeEach(() => {
  sdk.reset();
});

describe('GlueCatalogClient.listCatalogs', () => {
  it('returns the default account-level catalog placeholder', async () => {
    const c = new GlueCatalogClient({ region: 'us-east-1' });
    const list = await c.listCatalogs();
    expect(list).toEqual(['AwsDataCatalog']);
  });
});

describe('GlueCatalogClient.listDatabases', () => {
  it('paginates via NextToken', async () => {
    sdk
      .on(GetDatabasesCommand)
      .resolvesOnce({
        DatabaseList: [{ Name: 'db1' }, { Name: 'db2' }],
        NextToken: 'tok',
      })
      .resolvesOnce({ DatabaseList: [{ Name: 'db3' }], NextToken: undefined });

    const c = new GlueCatalogClient({ region: 'us-east-1' });
    const list = await c.listDatabases('AwsDataCatalog');
    expect(list).toEqual(['db1', 'db2', 'db3']);

    // The default catalog is passed implicitly: CatalogId omitted.
    const calls = sdk.commandCalls(GetDatabasesCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0].args[0].input.CatalogId).toBeUndefined();
    expect(calls[1].args[0].input.NextToken).toBe('tok');
  });

  it('passes through non-default catalog id', async () => {
    sdk.on(GetDatabasesCommand).resolves({ DatabaseList: [{ Name: 'db1' }] });
    const c = new GlueCatalogClient({ region: 'us-east-1' });
    await c.listDatabases('s3tablescatalog/my-bucket');
    const calls = sdk.commandCalls(GetDatabasesCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.CatalogId).toBe('s3tablescatalog/my-bucket');
  });

  it('filters AccessDenied silently', async () => {
    sdk.on(GetDatabasesCommand).rejects(
      Object.assign(new Error('AccessDenied: ...'), {
        name: 'AccessDeniedException',
      }),
    );
    const c = new GlueCatalogClient({ region: 'us-east-1' });
    const list = await c.listDatabases('AwsDataCatalog');
    expect(list).toEqual([]);
  });

  it('rethrows non-AccessDenied errors', async () => {
    sdk.on(GetDatabasesCommand).rejects(
      Object.assign(new Error('boom'), {
        name: 'InternalServiceException',
      }),
    );
    const c = new GlueCatalogClient({ region: 'us-east-1' });
    await expect(c.listDatabases('AwsDataCatalog')).rejects.toThrow(/boom/);
  });
});

describe('GlueCatalogClient.listTables', () => {
  it('paginates and reports format', async () => {
    sdk
      .on(GetTablesCommand)
      .resolvesOnce({
        TableList: [
          {
            Name: 'iceberg_events',
            TableType: 'EXTERNAL_TABLE',
            Parameters: { table_type: 'ICEBERG' },
          },
          {
            Name: 'parquet_logs',
            TableType: 'EXTERNAL_TABLE',
            StorageDescriptor: {
              SerdeInfo: {
                SerializationLibrary:
                  'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
              },
            },
          },
        ],
        NextToken: 'tok2',
      })
      .resolvesOnce({
        TableList: [
          {
            Name: 'csv_dump',
            TableType: 'EXTERNAL_TABLE',
            StorageDescriptor: {
              SerdeInfo: {
                SerializationLibrary:
                  'org.apache.hadoop.hive.serde2.OpenCSVSerde',
              },
            },
          },
          {
            Name: 'orc_metrics',
            TableType: 'EXTERNAL_TABLE',
            StorageDescriptor: {
              SerdeInfo: {
                SerializationLibrary:
                  'org.apache.hadoop.hive.ql.io.orc.OrcSerde',
              },
            },
          },
          {
            Name: 'mystery',
            TableType: 'EXTERNAL_TABLE',
          },
        ],
      });

    const c = new GlueCatalogClient({ region: 'us-east-1' });
    const list = await c.listTables('AwsDataCatalog', 'analytics_db');
    expect(list).toEqual([
      {
        database: 'analytics_db',
        table: 'iceberg_events',
        tableType: 'EXTERNAL_TABLE',
        format: 'iceberg',
      },
      {
        database: 'analytics_db',
        table: 'parquet_logs',
        tableType: 'EXTERNAL_TABLE',
        format: 'parquet',
      },
      {
        database: 'analytics_db',
        table: 'csv_dump',
        tableType: 'EXTERNAL_TABLE',
        format: 'csv',
      },
      {
        database: 'analytics_db',
        table: 'orc_metrics',
        tableType: 'EXTERNAL_TABLE',
        format: 'orc',
      },
      {
        database: 'analytics_db',
        table: 'mystery',
        tableType: 'EXTERNAL_TABLE',
        format: 'unknown',
      },
    ]);
  });

  it('filters AccessDenied silently', async () => {
    sdk.on(GetTablesCommand).rejects(
      Object.assign(new Error('denied'), {
        name: 'AccessDeniedException',
      }),
    );
    const c = new GlueCatalogClient({ region: 'us-east-1' });
    const list = await c.listTables('AwsDataCatalog', 'db1');
    expect(list).toEqual([]);
  });
});

describe('GlueCatalogClient.getTableSchema', () => {
  it('returns columns, partitionKeys, format, location', async () => {
    sdk.on(GetTableCommand).resolves({
      Table: {
        Name: 'events',
        TableType: 'EXTERNAL_TABLE',
        Parameters: { table_type: 'ICEBERG' },
        StorageDescriptor: {
          Location: 's3://bucket/events/',
          Columns: [
            { Name: 'event_id', Type: 'varchar' },
            { Name: 'event_time', Type: 'timestamp' },
          ],
        },
        PartitionKeys: [{ Name: 'event_date', Type: 'date' }],
      },
    });

    const c = new GlueCatalogClient({ region: 'us-east-1' });
    const schema = await c.getTableSchema(
      'AwsDataCatalog',
      'analytics_db',
      'events',
    );
    expect(schema.columns).toEqual([
      { name: 'event_id', type: 'varchar', isPartition: false },
      { name: 'event_time', type: 'timestamp', isPartition: false },
      { name: 'event_date', type: 'date', isPartition: true },
    ]);
    expect(schema.partitionKeys).toEqual(['event_date']);
    expect(schema.format).toBe('iceberg');
    expect(schema.location).toBe('s3://bucket/events/');
    expect(schema.tableType).toBe('EXTERNAL_TABLE');
    expect(schema.catalogId).toBe('AwsDataCatalog');
    expect(schema.database).toBe('analytics_db');
    expect(schema.table).toBe('events');
  });

  it('detects parquet format from serde lib when not Iceberg', async () => {
    sdk.on(GetTableCommand).resolves({
      Table: {
        Name: 'logs',
        TableType: 'EXTERNAL_TABLE',
        StorageDescriptor: {
          Location: 's3://bucket/logs/',
          Columns: [{ Name: 'msg', Type: 'varchar' }],
          SerdeInfo: {
            SerializationLibrary:
              'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
          },
        },
      },
    });
    const c = new GlueCatalogClient({ region: 'us-east-1' });
    const schema = await c.getTableSchema('AwsDataCatalog', 'db', 'logs');
    expect(schema.format).toBe('parquet');
    expect(schema.partitionKeys).toEqual([]);
  });

  it('surfaces EntityNotFoundException explicitly', async () => {
    sdk.on(GetTableCommand).rejects(
      Object.assign(new Error('Table not found'), {
        name: 'EntityNotFoundException',
      }),
    );
    const c = new GlueCatalogClient({ region: 'us-east-1' });
    await expect(
      c.getTableSchema('AwsDataCatalog', 'db', 'missing'),
    ).rejects.toMatchObject({ name: 'EntityNotFoundException' });
  });

  it('surfaces AccessDeniedException explicitly (does not silently filter)', async () => {
    sdk.on(GetTableCommand).rejects(
      Object.assign(new Error('denied'), {
        name: 'AccessDeniedException',
      }),
    );
    const c = new GlueCatalogClient({ region: 'us-east-1' });
    await expect(
      c.getTableSchema('AwsDataCatalog', 'db', 'forbidden'),
    ).rejects.toMatchObject({ name: 'AccessDeniedException' });
  });

  it('throws EntityNotFoundException when SDK returns no Table', async () => {
    sdk.on(GetTableCommand).resolves({});
    const c = new GlueCatalogClient({ region: 'us-east-1' });
    await expect(
      c.getTableSchema('AwsDataCatalog', 'db', 'ghost'),
    ).rejects.toMatchObject({ name: 'EntityNotFoundException' });
  });
});
