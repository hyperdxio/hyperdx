import { createClient } from '@clickhouse/client';
import { ClickHouseClient } from '@clickhouse/client-common';

import { ClickhouseClient as HdxClickhouseClient } from '@/clickhouse/node';
import { Metadata, MetadataCache } from '@/metadata';
import { ChartConfigWithDateRange } from '@/types';

describe('Metadata Integration Tests', () => {
  let client: ClickHouseClient;
  let hdxClient: HdxClickhouseClient;

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
    });

    describe.each([true, false])('with disableRowLimit=%s', disableRowLimit => {
      it('should return key-value pairs for a given metadata key', async () => {
        const resultSeverityText = await metadata.getKeyValues({
          chartConfig,
          keys: ['SeverityText'],
          disableRowLimit,
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
        });

        expect(resultEmpty).toEqual([]);
      });

      it('should correctly limit the number of returned values', async () => {
        const resultLimited = await metadata.getKeyValues({
          chartConfig,
          keys: ['SeverityText'],
          limit: 2,
        });

        expect(resultLimited).toHaveLength(1);
        expect(resultLimited[0].key).toBe('SeverityText');
        expect(resultLimited[0].value).toHaveLength(2);
        expect(
          resultLimited[0].value.every(v =>
            ['info', 'error', 'warning'].includes(v),
          ),
        ).toBeTruthy();
      });
    });
  });
});
