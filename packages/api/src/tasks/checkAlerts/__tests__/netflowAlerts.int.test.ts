import {
  ClickhouseClient,
  createNativeClient,
} from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import {
  AlertState,
  AlertThresholdType,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import * as config from '@/config';
import { createAlert } from '@/controllers/alerts';
import { createTeam } from '@/controllers/team';
import { getServer } from '@/fixtures';
import Alert, { AlertSource } from '@/models/alert';
import AlertHistory from '@/models/alertHistory';
import Connection from '@/models/connection';
import { SavedSearch } from '@/models/savedSearch';
import { NetflowSource } from '@/models/source';
import Webhook from '@/models/webhook';
import { processAlert } from '@/tasks/checkAlerts';
import { AlertTaskType, loadProvider } from '@/tasks/checkAlerts/providers';
import {
  fetchSampleLines,
  renderAlertTemplate,
} from '@/tasks/checkAlerts/template';
import * as slack from '@/utils/slack';

describe('NetFlow saved-search alerts', () => {
  const server = getServer();
  const nativeClient = createNativeClient({
    url: config.CLICKHOUSE_HOST,
    username: config.CLICKHOUSE_USER,
    password: config.CLICKHOUSE_PASSWORD,
  });
  const clickhouseClient = new ClickhouseClient({
    host: config.CLICKHOUSE_HOST,
    username: config.CLICKHOUSE_USER,
    password: config.CLICKHOUSE_PASSWORD,
  });
  const table = 'default.netflow_alert_test';
  const startTime = new Date('2023-11-16T22:05:00Z');
  const endTime = new Date('2023-11-16T22:10:00Z');
  const select = 'SrcAddr, Bytes * SamplingRate AS traffic';

  beforeAll(async () => {
    await server.start();
    await nativeClient.command({
      query: `CREATE TABLE ${table} (
        TimeReceived DateTime('UTC'), SrcAddr IPv6, DstAddr IPv6,
        SrcPort UInt16, DstPort UInt16, Proto UInt8,
        Bytes UInt64, Packets UInt64, SamplingRate UInt32
      ) ENGINE = Memory`,
    });
  });

  afterEach(async () => {
    await nativeClient.command({ query: `TRUNCATE TABLE ${table}` });
    await server.clearDBs();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await nativeClient.command({ query: `DROP TABLE IF EXISTS ${table}` });
    await nativeClient.close();
    await server.stop();
  });

  it.each([
    {
      name: 'default SELECT and Lucene',
      savedSelect: undefined,
      where: 'traffic:[1000 TO *]',
      whereLanguage: 'lucene' as const,
    },
    {
      name: 'empty SELECT and SQL',
      savedSelect: '',
      where: 'traffic >= 1000',
      whereLanguage: 'sql' as const,
    },
    {
      name: 'explicit SELECT and Lucene',
      savedSelect: select,
      where: 'traffic:[1000 TO *]',
      whereLanguage: 'lucene' as const,
    },
  ])(
    'evaluates and delivers $name with aliased samples',
    async ({ savedSelect, where, whereLanguage }) => {
      const postMessage = jest
        .spyOn(slack, 'postMessageToWebhook')
        .mockResolvedValue({ text: 'ok' });
      const team = await createTeam({ name: 'NetFlow alerts' });
      const connection = await Connection.create({
        team: team._id,
        name: 'Test ClickHouse',
        host: config.CLICKHOUSE_HOST,
        username: config.CLICKHOUSE_USER,
        password: config.CLICKHOUSE_PASSWORD,
      });
      const source = await NetflowSource.create({
        kind: SourceKind.Netflow,
        team: team._id,
        connection: connection.id,
        name: 'Flows',
        from: { databaseName: 'default', tableName: 'netflow_alert_test' },
        timestampValueExpression: 'TimeReceived',
        defaultTableSelectExpression: select,
        bytesExpression: 'Bytes',
        packetsExpression: 'Packets',
        samplingRateExpression: 'SamplingRate',
        srcAddrExpression: 'SrcAddr',
        dstAddrExpression: 'DstAddr',
        srcPortExpression: 'SrcPort',
        dstPortExpression: 'DstPort',
        protocolExpression: 'Proto',
      });
      const savedSearch = await SavedSearch.create({
        team: team._id,
        name: 'Large TCP flows',
        source: source.id,
        select: savedSelect,
        where,
        whereLanguage,
        filters: [{ type: 'sql', condition: 'Proto = 6' }],
        orderBy: 'SrcAddr',
        tags: [],
      });
      const webhook = await Webhook.create({
        team: team._id,
        name: 'Test webhook',
        service: 'slack',
        url: 'https://hooks.slack.com/services/netflow-test',
      });
      const alert = await createAlert(
        team._id,
        {
          name: 'Large TCP flow alert',
          source: AlertSource.SAVED_SEARCH,
          savedSearchId: savedSearch.id,
          channel: { type: 'webhook', webhookId: webhook.id },
          interval: '5m',
          thresholdType: AlertThresholdType.ABOVE,
          threshold: 2,
        },
        new mongoose.Types.ObjectId(),
      );
      await nativeClient.insert({
        table,
        format: 'JSONEachRow',
        values: [
          { SrcAddr: '2001:db8::1', Bytes: 20, SamplingRate: 100 },
          { SrcAddr: '2001:db8::2', Bytes: 30, SamplingRate: 100 },
          { SrcAddr: '2001:db8::3', Bytes: 30, SamplingRate: 100, Proto: 17 },
          { SrcAddr: '2001:db8::4', Bytes: 1, SamplingRate: 100 },
          {
            SrcAddr: '2001:db8::5',
            Bytes: 30,
            SamplingRate: 100,
            TimeReceived: '2023-11-16 22:10:00',
          },
        ].map(row => ({
          TimeReceived: '2023-11-16 22:05:00',
          DstAddr: '2001:db8::ffff',
          SrcPort: 443,
          DstPort: 50000,
          Proto: 6,
          Packets: 1,
          ...row,
        })),
      });
      const alertProvider = await loadProvider();
      const metadata = getMetadata(clickhouseClient);
      const teamWebhooksById = new Map([[webhook.id, webhook]]);
      const expectedSamples = '"2001:db8::1",2000\n"2001:db8::2",3000\n';
      expect(
        await fetchSampleLines({
          clickhouseClient,
          metadata,
          savedSearch,
          source,
          startTime,
          endTime,
        }),
      ).toBe(expectedSamples);

      await processAlert(
        new Date('2023-11-16T22:12:00Z'),
        {
          alert,
          source,
          savedSearch,
          taskType: AlertTaskType.SAVED_SEARCH,
          previousMap: new Map(),
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      expect(await Alert.findById(alert.id).lean()).toMatchObject({
        state: AlertState.ALERT,
        executionErrors: [],
      });
      const histories = await AlertHistory.find({ alert: alert.id }).lean();
      expect(histories).toHaveLength(1);
      expect(histories[0]).toMatchObject({
        state: AlertState.ALERT,
        lastValues: [{ count: 2 }],
      });
      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(postMessage.mock.calls[0][1])).toContain(
        '2 lines found',
      );
      expect(JSON.stringify(postMessage.mock.calls[0][1])).toContain(
        '2001:db8::1',
      );
      expect(JSON.stringify(postMessage.mock.calls[0][1])).not.toContain(
        '2001:db8::3',
      );

      // Standalone rendering must also fetch samples without the evaluator's cache.
      const rendered = await renderAlertTemplate({
        alertProvider,
        clickhouseClient,
        metadata,
        state: AlertState.ALERT,
        title: 'NetFlow alert',
        teamId: team.id,
        teamWebhooksById: new Map(),
        view: {
          alert: { ...alert.toObject(), channel: { type: null }, channels: [] },
          source,
          savedSearch,
          startTime,
          endTime,
          value: 2,
          attributes: {},
          granularity: '5m',
          isGroupedAlert: false,
        },
      });
      expect(rendered.failures).toEqual([]);
      expect(rendered.body).toContain(expectedSamples);
    },
  );
});
