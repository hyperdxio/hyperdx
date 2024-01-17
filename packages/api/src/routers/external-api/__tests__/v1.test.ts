import * as clickhouse from '@/clickhouse';
import AlertChannel from '@/models/alertChannel';
import Webhook from '@/models/webhook';
import {
  clearDBCollections,
  closeDB,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';

describe('external api v1', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await clearDBCollections();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await server.closeHttpServer();
    await closeDB();
  });

  it('GET /api/v1', async () => {
    const { agent, user } = await getLoggedInAgent(server);
    const resp = await agent
      .get(`/api/v1`)
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .expect(200);
    expect(resp.body.version).toEqual('v1');
    expect(resp.body.user._id).toEqual(user?._id.toString());
  });

  it('GET /api/v1/metrics/tags', async () => {
    jest.spyOn(clickhouse, 'getMetricsTags').mockResolvedValueOnce({
      data: [
        {
          name: 'system.filesystem.usage - Sum',
          tags: [
            {
              device: '/dev/vda1',
              host: 'unknown',
              mode: 'rw',
              mountpoint: '/etc/resolv.conf',
              state: 'reserved',
              type: 'ext4',
            },
          ],
          data_type: 'Sum',
        },
      ],
      meta: [
        {
          name: 'name',
          type: 'String',
        },
        {
          name: 'data_type',
          type: 'LowCardinality(String)',
        },
        {
          name: 'tags',
          type: 'Array(Map(String, String))',
        },
      ],
      rows: 1,
    } as any);
    const { agent, user } = await getLoggedInAgent(server);
    const resp = await agent
      .get(`/api/v1/metrics/tags`)
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .expect(200);

    expect(clickhouse.getMetricsTags).toBeCalledTimes(1);
    expect(resp.body).toEqual({
      data: [
        {
          name: 'system.filesystem.usage',
          tags: [
            {
              device: '/dev/vda1',
              host: 'unknown',
              mode: 'rw',
              mountpoint: '/etc/resolv.conf',
              state: 'reserved',
              type: 'ext4',
            },
          ],
          type: 'Sum',
        },
      ],
      meta: [
        {
          name: 'name',
          type: 'String',
        },
        {
          name: 'data_type',
          type: 'LowCardinality(String)',
        },
        {
          name: 'tags',
          type: 'Array(Map(String, String))',
        },
      ],
      rows: 1,
    });
  });

  describe('POST /api/v1/metrics/chart', () => {
    it('should return 400 if startTime is greater than endTime', async () => {
      const { agent, user } = await getLoggedInAgent(server);
      await agent
        .post(`/api/v1/metrics/chart`)
        .set('Authorization', `Bearer ${user?.accessKey}`)
        .send({
          aggFn: 'max_rate',
          endTime: 1701224193940,
          granularity: '30 second',
          name: 'http.server.active_requests',
          startTime: 1701233593940,
          type: 'Sum',
        })
        .expect(400);
    });

    it('suucess', async () => {
      jest.spyOn(clickhouse, 'getMetricsChart').mockResolvedValueOnce({
        data: [
          {
            ts_bucket: 1701223590,
            data: 10,
            group: 'http.server.active_requests',
          },
        ],
        meta: [
          {
            name: 'ts_bucket',
            type: 'UInt32',
          },
          {
            name: 'data',
            type: 'Float64',
          },
          {
            name: 'group',
            type: 'LowCardinality(String)',
          },
        ],
        rows: 1,
      });
      const { agent, user, team } = await getLoggedInAgent(server);
      const resp = await agent
        .post(`/api/v1/metrics/chart`)
        .set('Authorization', `Bearer ${user?.accessKey}`)
        .send({
          aggFn: 'max_rate',
          endTime: 1701224193940,
          granularity: '30 second',
          name: 'http.server.active_requests',
          startTime: 1701223593940,
          type: 'Sum',
        })
        .expect(200);

      expect(clickhouse.getMetricsChart).toHaveBeenNthCalledWith(1, {
        aggFn: 'max_rate',
        dataType: 'Sum',
        endTime: 1701224193940,
        granularity: '30 second',
        groupBy: undefined,
        name: 'http.server.active_requests',
        q: undefined,
        startTime: 1701223593940,
        teamId: team?._id.toString(),
      });
      expect(resp.body).toEqual({
        data: [
          {
            ts_bucket: 1701223590,
            data: 10,
            group: 'http.server.active_requests',
          },
        ],
        meta: [
          {
            name: 'ts_bucket',
            type: 'UInt32',
          },
          {
            name: 'data',
            type: 'Float64',
          },
          {
            name: 'group',
            type: 'LowCardinality(String)',
          },
        ],
        rows: 1,
      });
    });
  });

  // Users should be able to CRUD dashboards, saved searches and alerts, so that they can programatically create/manage the UI for various teams.

  // Ex. Team A is standing up a new service, they should be able to run a program (ex. Terraform) to automatically build all the alerts and dashboards they'd need to monitor their new service using their internal automation tools.

  // To do so we'll need to expose CRUD APIs to:

  // Manage alert channels (ex. Slack webhook, Opsgenie teams, etc.), possibly need to be able to import Oauth-based channels too like PD and Slack(???)

  // Create (& CRUD) a saved search with an alert threshold + alert attached, tagged to the right teams or whatever. (See HDX-379)

  // Create (& CRUD) a dashboard with charts that have alerts attached to them.

  // Users will want to be able to customize which of those saved searches/etc go to which team.

  describe('alert channels', () => {
    const exampleWebhook = {
      _id: '5f9d4c4f1c9d440000000001',
      name: 'test',
      service: 'slack',
      team: '5f9d4c4f1c9d440000000000',
      url: 'https://hooks.slack.com/services/1234/5678/9012',
    };

    const exampleChannel = {
      _id: '5f9d4c4f1c9d440000000000',
      type: 'webhook',
      webhookId: '5f9d4c4f1c9d440000000001',
      priority: 'P1',
      teamId: '5f9d4c4f1c9d440000000000',
    };

    beforeEach(async () => {
      await Webhook.create(exampleWebhook);
      await AlertChannel.create(exampleChannel);
    });

    describe('GET /api/v1/alert-channels', () => {
      it('success', async () => {
        const { agent, user, team } = await getLoggedInAgent(server);
        const resp = await agent
          .get(`/api/v1/alert-channels`)
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .expect(200);

        expect(resp.body.data).toEqual([exampleChannel]);
      });
    });

    describe('GET /api/v1/alert-channels/:id', () => {
      it('success', async () => {
        const { agent, user, team } = await getLoggedInAgent(server);
        const resp = await agent
          .get(`/api/v1/alert-channels/${exampleChannel._id}`)
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .expect(200);

        expect(resp.body.data).toEqual(exampleChannel);
      });
    });

    describe('POST /api/v1/alert-channels', () => {
      it('success', async () => {
        const { agent, user, team } = await getLoggedInAgent(server);
        const resp = await agent
          .post(`/api/v1/alert-channels`)
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .send({
            type: 'webhook',
            webhookId: '5f9d4c4f1c9d440000000001',
            priority: 'P2',
            teamId: '5f9d4c4f1c9d440000000000',
          })
          .expect(200);

        expect(resp.body.data).toEqual({
          _id: expect.any(String),
          type: 'webhook',
          webhookId: '5f9d4c4f1c9d440000000001',
          priority: 'P1',
          teamId: '5f9d4c4f1c9d440000000000',
        });
      });
    });

    describe('PUT /api/v1/alert-channels/:id', () => {
      it('success', async () => {
        const { agent, user, team } = await getLoggedInAgent(server);
        const resp = await agent
          .put(`/api/v1/alert-channels/${exampleChannel._id}`)
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .send({
            type: 'webhook',
            webhookId: '5f9d4c4f1c9d440000000001',
            priority: 'P2',
            teamId: '5f9d4c4f1c9d440000000000',
          })
          .expect(200);

        expect(resp.body.data).toEqual({
          _id: expect.any(String),
          type: 'webhook',
          webhookId: '5f9d4c4f1c9d440000000001',
          priority: 'P2',
          teamId: '5f9d4c4f1c9d440000000000',
        });
      });
    });
  });

  describe('saved searches', () => {});

  describe('dashboards', () => {});
});
