import { createClient } from '@clickhouse/client';
import { ClickHouseClient } from '@clickhouse/client-common';

import { ClickhouseClient as HdxClickhouseClient } from '@/clickhouse/node';
import { Metadata, MetadataCache } from '@/core/metadata';
import { ChartConfigWithDateRange, TSource } from '@/types';

describe('Metadata Integration Tests', () => {
  let client: ClickHouseClient;
  let hdxClient: HdxClickhouseClient;

  const source = {
    querySettings: [
      { setting: 'optimize_read_in_order', value: '0' },
      { setting: 'cast_keep_nullable', value: '0' },
    ],
  } as TSource;

  beforeAll(() => {
    const host = process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
    const username = process.env.CLICKHOUSE_USER || 'default';
    const password = process.env.CLICKHOUSE_PASSWORD || '';

    client = createClient({
      url: host,
      username,
      password,
    });

    hdxClient = new HdxClickhouseClient({
      host,
      username,
      password,
    });
  });

  describe('getKeyValues', () => {
    let metadata: Metadata;
    const chartConfig: ChartConfigWithDateRange = {
      connection: 'test_connection',
      from: {
        databaseName: 'default',
        tableName: 'test_table',
      },
      dateRange: [new Date('2023-01-01'), new Date('2025-01-01')],
      select: 'col1, col2',
      timestampValueExpression: 'Timestamp',
      where: '',
    };

    beforeAll(async () => {
      await client.command({
        query: `CREATE OR REPLACE TABLE default.test_table (
            Timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1)),
            SeverityText LowCardinality(String) CODEC(ZSTD(1)),
            TraceId String,
            LogAttributes JSON CODEC(ZSTD(1)),
            ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
            \`__hdx_materialized_k8s.pod.name\` String MATERIALIZED ResourceAttributes['k8s.pod.name'] CODEC(ZSTD(1)),
          ) 
          ENGINE = MergeTree()
          ORDER BY (Timestamp)
        `,
      });

      await client.command({
        query: `INSERT INTO default.test_table (Timestamp, SeverityText, TraceId, ResourceAttributes, LogAttributes) VALUES 
          ('2023-06-01 12:00:00', 'info', '1o2udn120d8n', { 'k8s.pod.name': 'pod1', 'env': 'prod' },'{"action":"ping"}'),
          ('2024-06-01 12:00:00', 'error', '67890-09098', { 'k8s.pod.name': 'pod2', 'env': 'prod' },'{}'),
          ('2024-06-01 12:00:00', 'info', '11h9238re1h92', { 'env': 'staging' },'{"user":"john"}'),
          ('2024-06-01 12:00:00', 'warning', '1o2udn120d8n', { 'k8s.pod.name': 'pod1', 'env': 'prod' }, '{"user":"jack","action":"login"}'),
          ('2024-06-01 12:00:00', '', '1o2udn120d8n', { 'env': 'prod' }, '{"user":"jane","action":"login"}')
        `,
      });
    });

    beforeEach(async () => {
      metadata = new Metadata(hdxClient, new MetadataCache());
    });

    afterAll(async () => {
      await client.command({
        query: 'DROP TABLE IF EXISTS default.test_table',
      });

      await client.close();
    });

    describe.each([true, false])('with disableRowLimit=%s', disableRowLimit => {
      it('should return key-value pairs for a given metadata key', async () => {
        const resultSeverityText = await metadata.getKeyValues({
          chartConfig,
          keys: ['SeverityText'],
          disableRowLimit,
          source,
        });

        expect(resultSeverityText).toHaveLength(1);
        expect(resultSeverityText[0].key).toBe('SeverityText');
        expect(resultSeverityText[0].value).toHaveLength(3);
        expect(resultSeverityText[0].value).toEqual(
          expect.arrayContaining(['info', 'error', 'warning']),
        );

        const resultTraceId = await metadata.getKeyValues({
          chartConfig,
          keys: ['TraceId'],
          disableRowLimit,
          source,
        });

        expect(resultTraceId).toHaveLength(1);
        expect(resultTraceId[0].key).toBe('TraceId');
        expect(resultTraceId[0].value).toHaveLength(3);
        expect(resultTraceId[0].value).toEqual(
          expect.arrayContaining([
            '1o2udn120d8n',
            '67890-09098',
            '11h9238re1h92',
          ]),
        );

        const resultBoth = await metadata.getKeyValues({
          chartConfig,
          keys: ['TraceId', 'SeverityText'],
          disableRowLimit,
          source,
        });

        expect(resultBoth).toEqual([
          {
            key: 'TraceId',
            value: expect.arrayContaining([
              '1o2udn120d8n',
              '67890-09098',
              '11h9238re1h92',
            ]),
          },
          {
            key: 'SeverityText',
            value: expect.arrayContaining(['info', 'error', 'warning']),
          },
        ]);
      });

      it('should handle materialized columns correctly', async () => {
        const resultPodName = await metadata.getKeyValues({
          chartConfig,
          keys: ['__hdx_materialized_k8s.pod.name'],
          disableRowLimit,
          source,
        });

        expect(resultPodName).toHaveLength(1);
        expect(resultPodName[0].key).toBe('__hdx_materialized_k8s.pod.name');
        expect(resultPodName[0].value).toHaveLength(2);
        expect(resultPodName[0].value).toEqual(
          expect.arrayContaining(['pod1', 'pod2']),
        );
      });

      it('should handle JSON columns correctly', async () => {
        const resultLogAttributes = await metadata.getKeyValues({
          chartConfig,
          keys: ['LogAttributes.user'],
          disableRowLimit,
          source,
        });

        expect(resultLogAttributes).toHaveLength(1);
        expect(resultLogAttributes[0].key).toBe('LogAttributes.user');
        expect(resultLogAttributes[0].value).toHaveLength(3);
        expect(resultLogAttributes[0].value).toEqual(
          expect.arrayContaining(['john', 'jack', 'jane']),
        );
      });

      it('should return an empty list when no keys are provided', async () => {
        const resultEmpty = await metadata.getKeyValues({
          chartConfig,
          keys: [],
          source,
        });

        expect(resultEmpty).toEqual([]);
      });

      it('should correctly limit the number of returned values', async () => {
        const resultLimited = await metadata.getKeyValues({
          chartConfig,
          keys: ['SeverityText'],
          limit: 2,
          source,
        });

        expect(resultLimited).toHaveLength(1);
        expect(resultLimited[0].key).toBe('SeverityText');
        expect(resultLimited[0].value).toHaveLength(2);
        expect(
          resultLimited[0].value.every(
            v =>
              typeof v === 'string' && ['info', 'error', 'warning'].includes(v),
          ),
        ).toBeTruthy();
      });
    });
  });

  describe('getKeyValuesWithMVs', () => {
    let metadata: Metadata;
    const baseTableName = 'test_logs_base';
    const mvTableName = 'test_logs_mv_1m';

    const chartConfig: ChartConfigWithDateRange = {
      connection: 'test_connection',
      from: {
        databaseName: 'default',
        tableName: baseTableName,
      },
      dateRange: [new Date('2024-01-01'), new Date('2024-01-31')],
      select: '',
      timestampValueExpression: 'Timestamp',
      where: '',
    };

    beforeAll(async () => {
      // Create base table
      await client.command({
        query: `CREATE OR REPLACE TABLE default.${baseTableName} (
            Timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1)),
            environment LowCardinality(String) CODEC(ZSTD(1)),
            service LowCardinality(String) CODEC(ZSTD(1)),
            status_code LowCardinality(String) CODEC(ZSTD(1)),
            region LowCardinality(String) CODEC(ZSTD(1)),
            message String CODEC(ZSTD(1))
          )
          ENGINE = MergeTree()
          ORDER BY (Timestamp)
        `,
      });

      // Create materialized view
      await client.command({
        query: `CREATE MATERIALIZED VIEW IF NOT EXISTS default.${mvTableName}
          ENGINE = SummingMergeTree()
          ORDER BY (environment, service, status_code, Timestamp)
          AS SELECT
            toStartOfMinute(Timestamp) as Timestamp,
            environment,
            service,
            status_code,
            count() as count
          FROM default.${baseTableName}
          GROUP BY Timestamp, environment, service, status_code
        `,
      });

      // Insert data again to populate the MV (MVs don't get historical data)
      await client.command({
        query: `INSERT INTO default.${baseTableName}
          (Timestamp, environment, service, status_code, region, message) VALUES
          ('2024-01-10 12:00:00', 'production', 'api', '200', 'us-east', 'Success'),
          ('2024-01-10 13:00:00', 'production', 'web', '200', 'us-west', 'Success'),
          ('2024-01-10 14:00:00', 'staging', 'api', '500', 'us-east', 'Error'),
          ('2024-01-10 15:00:00', 'staging', 'worker', '200', 'eu-west', 'Success'),
          ('2024-01-10 16:00:00', 'production', 'api', '404', 'us-east', 'Not found')
        `,
      });
    });

    beforeEach(async () => {
      metadata = new Metadata(hdxClient, new MetadataCache());
    });

    afterAll(async () => {
      await client.command({
        query: `DROP VIEW IF EXISTS default.${mvTableName}`,
      });
      await client.command({
        query: `DROP TABLE IF EXISTS default.${baseTableName}`,
      });
    });

    it('should fetch key values using materialized views when available', async () => {
      const source = {
        id: 'test-source',
        name: 'Test Logs',
        kind: 'otel-logs',
        from: { databaseName: 'default', tableName: baseTableName },
        timestampValueExpression: 'Timestamp',
        connection: 'test_connection',
        materializedViews: [
          {
            databaseName: 'default',
            tableName: mvTableName,
            dimensionColumns: 'environment, service, status_code',
            minGranularity: '1 minute',
            timestampColumn: 'Timestamp',
            aggregatedColumns: [{ aggFn: 'count', mvColumn: 'count' }],
          },
        ],
      };

      const result = await metadata.getKeyValuesWithMVs({
        chartConfig,
        keys: ['environment', 'service', 'status_code'],
        source: source as any,
      });

      expect(result).toHaveLength(3);

      const environmentResult = result.find(r => r.key === 'environment');
      expect(environmentResult?.value).toEqual(
        expect.arrayContaining(['production', 'staging']),
      );

      const serviceResult = result.find(r => r.key === 'service');
      expect(serviceResult?.value).toEqual(
        expect.arrayContaining(['api', 'web', 'worker']),
      );

      const statusCodeResult = result.find(r => r.key === 'status_code');
      expect(statusCodeResult?.value).toEqual(
        expect.arrayContaining(['200', '404', '500']),
      );
    });

    it('should fall back to base table for keys not in materialized view', async () => {
      const source = {
        id: 'test-source',
        name: 'Test Logs',
        kind: 'otel-logs',
        from: { databaseName: 'default', tableName: baseTableName },
        timestampValueExpression: 'Timestamp',
        connection: 'test_connection',
        materializedViews: [
          {
            databaseName: 'default',
            tableName: mvTableName,
            dimensionColumns: 'environment, service, status_code',
            minGranularity: '1 minute',
            timestampColumn: 'Timestamp',
            aggregatedColumns: [{ aggFn: 'count', mvColumn: 'count' }],
          },
        ],
      };

      // Query for keys both in and not in the MV
      const result = await metadata.getKeyValuesWithMVs({
        chartConfig,
        keys: ['environment', 'region'], // 'region' is NOT in the MV
        source: source as any,
      });

      expect(result).toHaveLength(2);

      const environmentResult = result.find(r => r.key === 'environment');
      expect(environmentResult?.value).toEqual(
        expect.arrayContaining(['production', 'staging']),
      );

      const regionResult = result.find(r => r.key === 'region');
      expect(regionResult?.value).toEqual(
        expect.arrayContaining(['us-east', 'us-west', 'eu-west']),
      );
    });

    it('should work without materialized views (fall back to base table)', async () => {
      const source = {
        id: 'test-source',
        name: 'Test Logs',
        kind: 'otel-logs',
        from: { databaseName: 'default', tableName: baseTableName },
        timestampValueExpression: 'Timestamp',
        connection: 'test_connection',
        materializedViews: [], // No MVs
      };

      const result = await metadata.getKeyValuesWithMVs({
        chartConfig,
        keys: ['environment', 'service'],
        source: source as any,
      });

      expect(result).toHaveLength(2);

      const environmentResult = result.find(r => r.key === 'environment');
      expect(environmentResult?.value).toEqual(
        expect.arrayContaining(['production', 'staging']),
      );

      const serviceResult = result.find(r => r.key === 'service');
      expect(serviceResult?.value).toEqual(
        expect.arrayContaining(['api', 'web', 'worker']),
      );
    });

    it('should work with an undefined source parameter (fall back to base table)', async () => {
      const result = await metadata.getKeyValuesWithMVs({
        chartConfig,
        keys: ['environment', 'service'],
        // No source parameter
        source: undefined,
      });

      expect(result).toHaveLength(2);

      const environmentResult = result.find(r => r.key === 'environment');
      expect(environmentResult?.value).toEqual(
        expect.arrayContaining(['production', 'staging']),
      );

      const serviceResult = result.find(r => r.key === 'service');
      expect(serviceResult?.value).toEqual(
        expect.arrayContaining(['api', 'web', 'worker']),
      );
    });

    it('should return empty array for empty keys', async () => {
      const source = {
        id: 'test-source',
        name: 'Test Logs',
        kind: 'otel-logs',
        from: { databaseName: 'default', tableName: baseTableName },
        timestampValueExpression: 'Timestamp',
        connection: 'test_connection',
        materializedViews: [
          {
            databaseName: 'default',
            tableName: mvTableName,
            dimensionColumns: 'environment, service, status_code',
            minGranularity: '1 minute',
            timestampColumn: 'Timestamp',
            aggregatedColumns: [{ aggFn: 'count', mvColumn: 'count' }],
          },
        ],
      };

      const result = await metadata.getKeyValuesWithMVs({
        chartConfig,
        keys: [],
        source: source as any,
      });

      expect(result).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      const source = {
        id: 'test-source',
        name: 'Test Logs',
        kind: 'otel-logs',
        from: { databaseName: 'default', tableName: baseTableName },
        timestampValueExpression: 'Timestamp',
        connection: 'test_connection',
        materializedViews: [
          {
            databaseName: 'default',
            tableName: mvTableName,
            dimensionColumns: 'environment, service, status_code',
            minGranularity: '1 minute',
            timestampColumn: 'Timestamp',
            aggregatedColumns: [{ aggFn: 'count', mvColumn: 'count' }],
          },
        ],
      };

      const result = await metadata.getKeyValuesWithMVs({
        chartConfig,
        keys: ['service'],
        source: source as any,
        limit: 2,
      });

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('service');
      expect(result[0].value.length).toBeLessThanOrEqual(2);
    });

    it('should work with disableRowLimit: true', async () => {
      const source = {
        id: 'test-source',
        name: 'Test Logs',
        kind: 'otel-logs',
        from: { databaseName: 'default', tableName: baseTableName },
        timestampValueExpression: 'Timestamp',
        connection: 'test_connection',
        materializedViews: [
          {
            databaseName: 'default',
            tableName: mvTableName,
            dimensionColumns: 'environment, service, status_code',
            minGranularity: '1 minute',
            timestampColumn: 'Timestamp',
            aggregatedColumns: [{ aggFn: 'count', mvColumn: 'count' }],
          },
        ],
      };

      // Should work with disableRowLimit: true (no row limits applied)
      const result = await metadata.getKeyValuesWithMVs({
        chartConfig,
        keys: ['environment', 'service', 'status_code'],
        source: source as any,
        disableRowLimit: true,
      });

      expect(result).toHaveLength(3);

      const environmentResult = result.find(r => r.key === 'environment');
      expect(environmentResult?.value).toEqual(
        expect.arrayContaining(['production', 'staging']),
      );

      const serviceResult = result.find(r => r.key === 'service');
      expect(serviceResult?.value).toEqual(
        expect.arrayContaining(['api', 'web', 'worker']),
      );

      const statusCodeResult = result.find(r => r.key === 'status_code');
      expect(statusCodeResult?.value).toEqual(
        expect.arrayContaining(['200', '404', '500']),
      );
    });
  });

  describe('Distributed tables support', () => {
    let metadata: Metadata;
    const localTableName = 'test_dist_local';
    const distributedTableName = 'test_dist';

    beforeAll(async () => {
      await client.command({
        query: `CREATE OR REPLACE TABLE default.${localTableName} (
            Timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1)),
            ServiceName LowCardinality(String) CODEC(ZSTD(1)),
            Body String CODEC(ZSTD(1)),
            ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
            INDEX idx_body Body TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 8,
            INDEX idx_ts Timestamp TYPE minmax GRANULARITY 1
          )
          ENGINE = MergeTree()
          PARTITION BY toDate(Timestamp)
          ORDER BY (ServiceName, Timestamp)
        `,
      });

      await client.command({
        query: `CREATE OR REPLACE TABLE default.${distributedTableName}
          AS default.${localTableName}
          ENGINE = Distributed('hdx_cluster', 'default', '${localTableName}', rand())
        `,
      });
    });

    beforeEach(() => {
      metadata = new Metadata(hdxClient, new MetadataCache());
    });

    afterAll(async () => {
      await client.command({
        query: `DROP TABLE IF EXISTS default.${distributedTableName}`,
      });
      await client.command({
        query: `DROP TABLE IF EXISTS default.${localTableName}`,
      });
    });

    it('should return local table keys for a distributed table', async () => {
      const result = await metadata.getTableMetadata({
        databaseName: 'default',
        tableName: distributedTableName,
        connectionId: 'test_connection',
      });

      // Should have the distributed table's create_table_query
      expect(result.create_table_query).toContain(distributedTableName);
      expect(result.create_table_query).toContain('Distributed');

      // Should have the local table's create_table_query
      expect(result.create_local_table_query).toContain(localTableName);
      expect(result.create_local_table_query).toContain('MergeTree');

      // Keys should come from the local table
      expect(result.primary_key).toBe('ServiceName, Timestamp');
      expect(result.sorting_key).toBe('ServiceName, Timestamp');
      expect(result.partition_key).toBe('toDate(Timestamp)');

      // Engine should be overridden with local table's engine
      expect(result.engine).toBe('MergeTree');
    });

    it('should not set create_local_table_query for non-distributed tables', async () => {
      const result = await metadata.getTableMetadata({
        databaseName: 'default',
        tableName: localTableName,
        connectionId: 'test_connection',
      });

      expect(result.create_local_table_query).toBeUndefined();
      expect(result.engine).toBe('MergeTree');
      expect(result.primary_key).toBe('ServiceName, Timestamp');
    });

    it('should return skip indices from the local table when querying a distributed table', async () => {
      const result = await metadata.getSkipIndices({
        databaseName: 'default',
        tableName: distributedTableName,
        connectionId: 'test_connection',
      });

      expect(result).toHaveLength(2);

      const bodyIndex = result.find(idx => idx.name === 'idx_body');
      expect(bodyIndex).toBeDefined();
      expect(bodyIndex!.type).toBe('tokenbf_v1');
      expect(bodyIndex!.expression).toBe('Body');
      expect(bodyIndex!.granularity).toBe(8);

      const tsIndex = result.find(idx => idx.name === 'idx_ts');
      expect(tsIndex).toBeDefined();
      expect(tsIndex!.type).toBe('minmax');
      expect(tsIndex!.granularity).toBe(1);
    });

    it('should return skip indices directly for a non-distributed table', async () => {
      const result = await metadata.getSkipIndices({
        databaseName: 'default',
        tableName: localTableName,
        connectionId: 'test_connection',
      });

      expect(result).toHaveLength(2);
      expect(result.map(idx => idx.name)).toEqual(
        expect.arrayContaining(['idx_body', 'idx_ts']),
      );
    });
  });

  describe('getSetting', () => {
    let metadata: Metadata;
    beforeEach(async () => {
      metadata = new Metadata(hdxClient, new MetadataCache());
    });

    it('should get setting that exists and is enabled', async () => {
      const settingValue = await metadata.getSetting({
        settingName: 'format_csv_allow_single_quotes',
        connectionId: 'test_connection',
      });
      expect(settingValue).toBe('0');
    });

    it('should get setting that exists and is disabled', async () => {
      const settingValue = await metadata.getSetting({
        settingName: 'format_csv_allow_double_quotes',
        connectionId: 'test_connection',
      });
      expect(settingValue).toBe('1');
    });

    it('should return undefined for setting that does not exist', async () => {
      const settingValue = await metadata.getSetting({
        settingName: 'enable_quantum_tunnelling',
        connectionId: 'test_connection',
      });
      expect(settingValue).toBeUndefined();
    });
  });
});
