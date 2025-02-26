// TODO: we might want to move this test file to common-utils package

import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse';
import { getMetadata } from '@hyperdx/common-utils/dist/metadata';
import { renderChartConfig } from '@hyperdx/common-utils/dist/renderChartConfig';
import _ from 'lodash';

import * as config from '@/config';
import { createTeam } from '@/controllers/team';
import {
  bulkInsertLogs,
  DEFAULT_DATABASE,
  DEFAULT_LOGS_TABLE,
  getServer,
} from '@/fixtures';
import Connection from '@/models/connection';
import { Source } from '@/models/source';

describe('renderChartConfig', () => {
  const server = getServer();

  let team, connection, logSource, metricSource, metadata;
  let clickhouseClient: ClickhouseClient;

  beforeAll(async () => {
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(async () => {
    team = await createTeam({ name: 'My Team' });
    connection = await Connection.create({
      team: team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    logSource = await Source.create({
      kind: 'log',
      team: team._id,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: DEFAULT_LOGS_TABLE,
      },
      timestampValueExpression: 'Timestamp',
      connection: connection.id,
      name: 'Logs',
    });
    clickhouseClient = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });
    metadata = getMetadata(clickhouseClient);
  });

  afterEach(async () => {
    await server.clearDBs();
    jest.clearAllMocks();
  });

  describe('Query Events', () => {
    it('simple select + where query logs', async () => {
      const now = new Date('2023-11-16T22:12:00.000Z');
      await bulkInsertLogs([
        {
          ServiceName: 'api',
          Timestamp: now,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        {
          ServiceName: 'api',
          Timestamp: now,
          SeverityText: 'info',
          Body: 'This is a test message.',
        },
      ]);
      const query = await renderChartConfig(
        {
          select: [
            {
              valueExpression: 'Body',
            },
          ],
          from: logSource.from,
          where: `SeverityText = 'error'`,
          timestampValueExpression: 'Timestamp',
          connection: connection.id,
        },
        metadata,
      );

      const resp = await clickhouseClient
        .query<'JSON'>({
          query: query.sql,
          query_params: query.params,
          format: 'JSON',
        })
        .then(res => res.json<any>());
      expect(resp.data).toMatchSnapshot();
    });

    it('simple select + group by query logs', async () => {
      const now = new Date('2023-11-16T22:12:00.000Z');
      await bulkInsertLogs([
        {
          ServiceName: 'api',
          Timestamp: now,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        {
          ServiceName: 'app',
          Timestamp: now,
          SeverityText: 'info',
          Body: 'This is a test message.',
        },
      ]);
      const query = await renderChartConfig(
        {
          select: [
            {
              valueExpression: 'ServiceName',
            },
            {
              valueExpression: 'count()',
              alias: 'count',
            },
          ],
          from: logSource.from,
          where: '',
          timestampValueExpression: 'Timestamp',
          connection: connection.id,
          groupBy: 'ServiceName',
        },
        metadata,
      );

      const resp = await clickhouseClient
        .query<'JSON'>({
          query: query.sql,
          query_params: query.params,
          format: 'JSON',
        })
        .then(res => res.json<any>());
      expect(resp.data).toMatchSnapshot();
    });

    // TODO: add more tests (including events chart, using filters, etc)
  });

  describe('Query Metrics', () => {});
});
