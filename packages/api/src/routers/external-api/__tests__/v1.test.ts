import e from 'express';

import * as clickhouse from '@/clickhouse';
import {
  clearDBCollections,
  closeDB,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import AlertChannel from '@/models/alertChannel';
import Dashboard, { Chart } from '@/models/dashboard';
import LogView from '@/models/logView';
import user from '@/models/user';
import Webhook from '@/models/webhook';

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

  describe('alert channels', () => {
    const exampleWebhook = {
      _id: '5f9d4c4f1c9d440000000001',
      name: 'test',
      service: 'slack',
      url: 'https://hooks.slack.com/services/1234/5678/9012',
    };

    const exampleChannel = {
      _id: '5f9d4c4f1c9d440000000000',
      type: 'webhook',
      webhookId: '5f9d4c4f1c9d440000000001',
      priority: 'P1',
    };

    describe('GET /api/v1/alert-channels', () => {
      it('success', async () => {
        const { agent, user } = await getLoggedInAgent(server);
        await Webhook.create({
          ...exampleWebhook,
          team: user?.team,
        });
        await AlertChannel.create({
          ...exampleChannel,
          teamId: user?.team,
        });
        const resp = await agent
          .get(`/api/v1/alert-channels`)
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .expect(200);

        expect(resp.body.data.length).toEqual(1);
        expect(resp.body.data[0]).toEqual({
          ...exampleChannel,
          __v: expect.any(Number),
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
          teamId: user.team?._id.toString(),
        });
      });
    });

    describe('GET /api/v1/alert-channels/:id', () => {
      it('success', async () => {
        const { agent, user } = await getLoggedInAgent(server);
        await Webhook.create({
          ...exampleWebhook,
          team: user?.team,
        });
        await AlertChannel.create({
          ...exampleChannel,
          teamId: user?.team,
        });
        const resp = await agent
          .get(`/api/v1/alert-channels/${exampleChannel._id}`)
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .expect(200);

        expect(resp.body.data).toEqual({
          ...exampleChannel,
          __v: expect.any(Number),
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
          teamId: user.team?._id.toString(),
        });
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
            teamId: '5f9d4c4f1c9d440000000000', // make sure they can't send teamId
          })
          .expect(200);

        expect(resp.body.data).toEqual({
          _id: expect.any(String),
          type: 'webhook',
          webhookId: '5f9d4c4f1c9d440000000001',
          priority: 'P2',
          __v: expect.any(Number),
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
          teamId: user.team?._id.toString(),
        });
      });
    });

    describe('PUT /api/v1/alert-channels/:id', () => {
      it('success', async () => {
        const { agent, user } = await getLoggedInAgent(server);
        const webhook = await Webhook.create({
          ...exampleWebhook,
          team: user?.team,
        });
        const channel = await AlertChannel.create({
          ...exampleChannel,
          priority: 'P1', // ensure it is different
          teamId: user?.team,
        });
        const resp = await agent
          .put(`/api/v1/alert-channels/${channel._id}`)
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .send({
            type: 'webhook',
            webhookId: webhook._id.toString(),
            priority: 'P2',
            teamId: '5f9d4c4f1c9d440000000000', // make sure cannot update teamId
          })
          .expect(200);

        expect(resp.body.data).toEqual({
          _id: expect.any(String),
          type: 'webhook',
          webhookId: webhook._id.toString(),
          priority: 'P2',
          __v: expect.any(Number),
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
          teamId: user.team?._id.toString(),
        });

        const updated = await AlertChannel.findById(channel._id);
        expect(updated?.priority).toBe('P2');
      });
    });

    describe('DELETE /api/v1/alert-channels/:id', () => {
      it('success', async () => {
        const { agent, user, team } = await getLoggedInAgent(server);
        await agent
          .delete(`/api/v1/alert-channels/${exampleChannel._id}`)
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .expect(200);

        const found = await AlertChannel.findById(exampleChannel._id);
        expect(found).toBeNull();
      });
    });
  });

  describe('saved searches', () => {
    const exampleSearch = {
      _id: '5f9d4c4f1c9d50000000000',
      name: 'test',
      query: 'test',
      teamId: '5f9d4c4f1c9d440000000000',
      // creator should be set, but to the dynamic user id
    };

    beforeAll(async () => {
      await LogView.create(exampleSearch);
    });

    describe('GET /api/v1/searches', () => {
      it('success', async () => {
        const { agent, user, team } = await getLoggedInAgent(server);
        const resp = await agent
          .get(`/api/v1/searches`)
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .expect(200);

        expect(resp.body.data).toEqual([exampleSearch]);
        expect(resp.body.data[0].creator).toEqual(user._id);
      });
    });

    describe('GET /api/v1/searches/:id', () => {
      it('success', async () => {
        const { agent, user, team } = await getLoggedInAgent(server);
        const resp = await agent
          .get(`/api/v1/saved-searches/${exampleSearch._id}`)
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .expect(200);

        expect(resp.body.data).toEqual(exampleSearch);
        expect(resp.body.data.creator).toEqual(user._id);
      });
    });

    describe('POST /api/v1/searches', () => {
      it('success', async () => {
        const { agent, user, team } = await getLoggedInAgent(server);
        const resp = await agent
          .post(`/api/v1/searches`)
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .send({
            name: 'test_create',
            query: 'test_create',
            teamId: '5f9d4c4f1c9d440000000000',
          })
          .expect(200);

        expect(resp.body.data).toEqual({
          _id: expect.any(String),
          name: 'test_create',
          query: 'test_create',
          teamId: '5f9d4c4f1c9d440000000000',
        });
        expect(resp.body.data.creator).toEqual(user._id);
      });
    });

    describe('PUT /api/v1/searches/:id', () => {
      it('success', async () => {
        const { agent, user, team } = await getLoggedInAgent(server);
        const resp = await agent
          .put(`/api/v1/searches/${exampleSearch._id}`)
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .send({
            name: 'test2',
            query: 'test2',
            teamId: '5f9d4c4f1c9d440000000000',
          })
          .expect(200);

        expect(resp.body.data).toEqual({
          _id: expect.any(String),
          name: 'test2',
          query: 'test2',
          teamId: '5f9d4c4f1c9d440000000000',
        });
        expect(resp.body.data.creator).toEqual(user._id);
      });
    });

    describe('DELETE /api/v1/searches/:id', () => {
      it('success', async () => {
        const { agent, user, team } = await getLoggedInAgent(server);
        await agent
          .delete(`/api/v1/searches/${exampleSearch._id}`)
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .expect(200);

        const found = await LogView.findById(exampleSearch._id);
        expect(found).toBeNull();
      });
    });
  });

  describe('dashboards', () => {
    // gently borrowed from preset dashboards in frontend
    const exampleDashboard = {
      id: '110000000',
      name: 'App Performance',
      charts: [
        {
          id: '1624425',
          name: 'P95 Latency by Operation',
          x: 0,
          y: 0,
          w: 8,
          h: 3,
          series: [
            {
              type: 'time',
              aggFn: 'p95',
              field: 'duration',
              where: '',
              groupBy: ['span_name'],
            },
          ],
        },
        {
          id: '401924',
          name: 'Operations with Errors',
          x: 8,
          y: 0,
          w: 4,
          h: 3,
          series: [
            {
              type: 'time',
              aggFn: 'count',
              where: 'level:err',
              groupBy: ['span_name'],
            },
          ],
        },
        {
          id: '883200',
          name: 'Count of Operations',
          x: 0,
          y: 3,
          w: 8,
          h: 3,
          series: [
            {
              type: 'time',
              aggFn: 'count',
              where: '',
              groupBy: ['span_name'],
            },
          ],
        },
      ],
    };

    beforeAll(async () => {
      await Dashboard.create(exampleDashboard);
    });
    describe('GET /api/v1/dashboards', () => {
      it('success', async () => {
        const { agent, user, team } = await getLoggedInAgent(server);
        const resp = await agent
          .get(`/api/v1/dashboards`)
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .expect(200);

        expect(resp.body.data).toEqual([exampleDashboard]);
      });
    });

    describe('GET /api/v1/dashboards/:id', () => {
      it('success', async () => {
        const { agent, user, team } = await getLoggedInAgent(server);
        const resp = await agent
          .get(`/api/v1/dashboards/${exampleDashboard.id}`)
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .expect(200);

        expect(resp.body.data).toEqual(exampleDashboard);
      });
    });

    describe('POST /api/v1/dashboards', () => {
      it('success', async () => {
        const { agent, user, team } = await getLoggedInAgent(server);
        const resp = await agent
          .post(`/api/v1/dashboards`)
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .send({
            name: 'test_create',
            charts: [
              {
                id: '100000',
                name: 'P99 Latency by Operation',
                x: 0,
                y: 0,
                w: 8,
                h: 3,
                series: [
                  {
                    type: 'time',
                    aggFn: 'p99',
                    field: 'duration',
                    where: '',
                    groupBy: ['span_name'],
                  },
                ],
              },
            ],
          })
          .expect(200);

        expect(resp.body.data).toEqual({
          id: expect.any(String),
          name: 'test_create',
          charts: [
            {
              id: '100000',
              name: 'P99 Latency by Operation',
              x: 0,
              y: 0,
              w: 8,
              h: 3,
              series: [
                {
                  type: 'time',
                  aggFn: 'p99',
                  field: 'duration',
                  where: '',
                  groupBy: ['span_name'],
                },
              ],
            },
          ],
        });
      });
    });

    describe('PUT /api/v1/dashboard/:id', () => {
      it('success', async () => {
        const { agent, user, team } = await getLoggedInAgent(server);
        const resp = await agent
          .put(`/api/v1/dashboards/${exampleDashboard.id}`)
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .send({
            ...exampleDashboard,
            name: 'test_update',
          })
          .expect(200);

        expect(resp.body.data).toEqual({
          id: expect.any(String),
          name: 'test_update',
          charts: exampleDashboard.charts,
        });
      });
    });

    describe('DELETE /api/v1/dashboard/:id', () => {
      it('success', async () => {
        const { agent, user, team } = await getLoggedInAgent(server);
        await agent
          .delete(`/api/v1/dashboards/${exampleDashboard.id}`)
          .set('Authorization', `Bearer ${user?.accessKey}`)
          .expect(200);

        const found = await Dashboard.findById(exampleDashboard.id);
        expect(found).toBeNull();
      });
    });
  });
});
