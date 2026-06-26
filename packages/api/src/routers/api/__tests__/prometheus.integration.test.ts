import { Types } from 'mongoose';

import * as config from '@/config';
import { getAgent, getLoggedInAgent, getServer } from '@/fixtures';
import Connection from '@/models/connection';

const mockFetch = global.fetch as jest.Mock;

// The proxy now streams the upstream response straight through (no
// `await resp.json()`), so test mocks must expose the fields the pipeline
// actually reads: `status`, `headers.get()`, and a web `ReadableStream` body.
function fakeUpstreamResponse(payload: unknown, status = 200) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(payload)));
      controller.close();
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    body,
    text: jest.fn().mockResolvedValue(JSON.stringify(payload)),
    json: jest.fn().mockResolvedValue(payload),
  };
}

describe('prometheus router', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(fakeUpstreamResponse({}) as any);
  });

  afterAll(async () => {
    await server.stop();
  });

  const seedPrometheusConnection = async (teamId: Types.ObjectId) => {
    return Connection.create({
      team: teamId,
      name: 'Prom',
      host: 'http://prom.example.com',
      username: '',
      password: '',
      isPrometheusEndpoint: true,
    });
  };

  const seedClickHouseConnection = async (teamId: Types.ObjectId) => {
    return Connection.create({
      team: teamId,
      name: 'CH',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
  };

  describe('GET /v1/prometheus/query_range', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const anon = getAgent(server);
      await anon.get('/v1/prometheus/query_range').expect(401);
    });

    it('returns 400 when query parameter is missing', async () => {
      const { agent } = await getLoggedInAgent(server);
      const res = await agent
        .get('/v1/prometheus/query_range')
        .query({ connectionId: new Types.ObjectId().toString() })
        .expect(400);
      expect(res.body).toMatchObject({
        status: 'error',
        errorType: 'bad_data',
        error: expect.stringContaining('query'),
      });
    });

    it('returns 400 when connectionId parameter is missing', async () => {
      const { agent } = await getLoggedInAgent(server);
      const res = await agent
        .get('/v1/prometheus/query_range')
        .query({ query: 'up' })
        .expect(400);
      expect(res.body).toMatchObject({
        status: 'error',
        errorType: 'bad_data',
        error: expect.stringContaining('connectionId'),
      });
    });

    it('returns 404 when connection does not exist', async () => {
      const { agent } = await getLoggedInAgent(server);
      const res = await agent
        .get('/v1/prometheus/query_range')
        .query({
          query: 'up',
          connectionId: new Types.ObjectId().toString(),
        })
        .expect(404);
      expect(res.body).toMatchObject({
        status: 'error',
        error: 'Connection not found',
      });
    });

    it('proxies to upstream Prometheus when connection isPrometheusEndpoint', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      const promResponse = {
        status: 'success',
        data: { resultType: 'matrix', result: [] },
      };
      mockFetch.mockResolvedValueOnce(
        fakeUpstreamResponse(promResponse) as any,
      );

      const res = await agent
        .get('/v1/prometheus/query_range')
        .query({
          query: 'up',
          start: '1700000000',
          end: '1700000060',
          step: '15s',
          connectionId: conn._id.toString(),
        })
        .expect(200);

      expect(res.body).toEqual(promResponse);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('http://prom.example.com');
      expect(calledUrl).toContain('/api/v1/query_range');
      expect(calledUrl).toContain('query=up');
      expect(calledUrl).not.toContain('connectionId');
    });

    it('does NOT proxy to Prometheus when connection is not isPrometheusEndpoint', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedClickHouseConnection(team._id);

      // ClickHouse path: will likely fail with 400 because metrics_ts
      // is not seeded in the test CH, but the routing decision is what we
      // care about — fetch must not be called.
      await agent.get('/v1/prometheus/query_range').query({
        query: 'up',
        start: '1700000000',
        end: '1700000060',
        connectionId: conn._id.toString(),
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns 400 with Prometheus-compatible error when resolution exceeds 11,000 points', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedClickHouseConnection(team._id);

      const res = await agent
        .get('/v1/prometheus/query_range')
        .query({
          query: 'up',
          start: '0',
          end: '1700000000',
          step: '1s',
          connectionId: conn._id.toString(),
        })
        .expect(400);
      expect(res.body).toMatchObject({
        status: 'error',
        errorType: 'bad_data',
        error: expect.stringContaining('11,000 points'),
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('GET /v1/prometheus/query', () => {
    it('returns 400 when query parameter is missing', async () => {
      const { agent } = await getLoggedInAgent(server);
      await agent
        .get('/v1/prometheus/query')
        .query({ connectionId: new Types.ObjectId().toString() })
        .expect(400);
    });

    it('returns 400 when connectionId parameter is missing', async () => {
      const { agent } = await getLoggedInAgent(server);
      await agent
        .get('/v1/prometheus/query')
        .query({ query: 'up' })
        .expect(400);
    });

    it('returns 404 when connection does not exist', async () => {
      const { agent } = await getLoggedInAgent(server);
      await agent
        .get('/v1/prometheus/query')
        .query({
          query: 'up',
          connectionId: new Types.ObjectId().toString(),
        })
        .expect(404);
    });

    it('proxies to upstream Prometheus when connection isPrometheusEndpoint', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      const promResponse = {
        status: 'success',
        data: { resultType: 'vector', result: [] },
      };
      mockFetch.mockResolvedValueOnce(
        fakeUpstreamResponse(promResponse) as any,
      );

      const res = await agent
        .get('/v1/prometheus/query')
        .query({ query: 'up', connectionId: conn._id.toString() })
        .expect(200);

      expect(res.body).toEqual(promResponse);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/api/v1/query');
      expect(calledUrl).not.toContain('/api/v1/query_range');
    });
  });

  describe('GET /v1/prometheus/label/:name/values', () => {
    it('returns 400 when connectionId parameter is missing', async () => {
      const { agent } = await getLoggedInAgent(server);
      await agent.get('/v1/prometheus/label/__name__/values').expect(400);
    });

    it('returns 404 when connection does not exist', async () => {
      const { agent } = await getLoggedInAgent(server);
      await agent
        .get('/v1/prometheus/label/__name__/values')
        .query({ connectionId: new Types.ObjectId().toString() })
        .expect(404);
    });

    it('proxies to upstream Prometheus when connection isPrometheusEndpoint', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      const promResponse = { status: 'success', data: ['up', 'requests'] };
      mockFetch.mockResolvedValueOnce(
        fakeUpstreamResponse(promResponse) as any,
      );

      const res = await agent
        .get('/v1/prometheus/label/__name__/values')
        .query({ connectionId: conn._id.toString() })
        .expect(200);

      expect(res.body).toEqual(promResponse);
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/api/v1/label/__name__/values');
    });
  });
});
