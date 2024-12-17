import * as clickhouse from '@/clickhouse';
import { getLoggedInAgent, getServer } from '@/fixtures';

describe.skip('external api v1', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await server.stop();
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
    jest.spyOn(clickhouse, 'getMetricsTagsDEPRECATED').mockResolvedValueOnce({
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

    expect(clickhouse.getMetricsTagsDEPRECATED).toBeCalledTimes(1);
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
});
