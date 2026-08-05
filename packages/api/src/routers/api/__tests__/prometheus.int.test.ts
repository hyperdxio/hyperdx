import { Types } from 'mongoose';

import * as config from '@/config';
import { getAgent, getLoggedInAgent, getServer } from '@/fixtures';
import Connection from '@/models/connection';
import { PROMETHEUS_MAX_EXEMPLAR_WINDOW_SEC } from '@/routers/api/prometheus';

const mockFetch = global.fetch as jest.Mock;

// The proxy now streams the upstream response straight through (no
// `await resp.json()`), so test mocks must expose the fields the pipeline
// actually reads: `status`, `headers.get()`, and a web `ReadableStream` body.
// Returned as `Response` so callers can hand it straight to `mockResolvedValue`
// without an `as any` at every site — the proxy only touches the fields below.
function fakeUpstreamResponse(
  payload: unknown,
  status = 200,
  contentType = 'application/json',
): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(payload)));
      controller.close();
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': contentType }),
    body,
    text: jest.fn().mockResolvedValue(JSON.stringify(payload)),
    json: jest.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

describe('prometheus router', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(fakeUpstreamResponse({}));
  });

  afterAll(async () => {
    await server.stop();
  });

  const seedPrometheusConnection = async (
    teamId: Types.ObjectId,
    host = 'http://prom.example.com',
  ) => {
    return Connection.create({
      team: teamId,
      name: 'Prom',
      host,
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

    // The connection host is member-configured, so its response body is untrusted
    // output on our own origin: /api/* is same-origin-proxied by the app and the
    // session cookie is sameSite lax. A text/html body forwarded verbatim would
    // render as script here.
    it('never forwards a non-JSON upstream content-type, and always sends nosniff', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      mockFetch.mockResolvedValueOnce(
        fakeUpstreamResponse(
          '<script>alert(document.cookie)</script>',
          200,
          'text/html',
        ),
      );

      const res = await agent
        .get('/v1/prometheus/query_exemplars')
        .query({
          query: 'up',
          start: '1700000000',
          end: '1700000060',
          connectionId: conn._id.toString(),
        })
        .expect(200);

      expect(res.headers['content-type']).toContain('application/json');
      expect(res.headers['content-type']).not.toContain('text/html');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    // The reason the content-type is relabelled rather than allowlisted. A
    // prefix-anchored JSON test passes this value — the comma is a word boundary
    // — but the browser's MIME extraction keeps the *last* essence, so the body
    // would render as HTML on our own origin. `Headers.get()` also joins two
    // separate Content-Type headers into exactly this shape.
    it('does not forward a JSON content-type that carries a second media type', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      mockFetch.mockResolvedValueOnce(
        fakeUpstreamResponse(
          '<script>alert(document.cookie)</script>',
          200,
          'application/json, text/html',
        ),
      );

      const res = await agent
        .get('/v1/prometheus/query_exemplars')
        .query({
          query: 'up',
          start: '1700000000',
          end: '1700000060',
          connectionId: conn._id.toString(),
        })
        .expect(200);

      expect(res.headers['content-type']).not.toContain('text/html');
      expect(res.headers['content-type']).toBe(
        'application/json; charset=utf-8',
      );
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    // A distinguishable JSON flavour, so this cannot pass by coinciding with the
    // fallback: the upstream value must not survive even when it is valid JSON.
    it('relabels even a legitimate non-standard JSON content-type', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      mockFetch.mockResolvedValueOnce(
        fakeUpstreamResponse(
          { status: 'success', data: [] },
          200,
          'application/vnd.api+json',
        ),
      );

      const res = await agent
        .get('/v1/prometheus/query_exemplars')
        .query({
          query: 'up',
          start: '1700000000',
          end: '1700000060',
          connectionId: conn._id.toString(),
        })
        .expect(200);

      expect(res.headers['content-type']).toBe(
        'application/json; charset=utf-8',
      );
      expect(res.headers['content-type']).not.toContain('vnd.api');
    });

    // The unreachable-upstream path builds its message from the target URL, so
    // it needs nosniff too — and must not echo basic-auth credentials from a
    // connection host into a body the browser shows.
    it('sends nosniff on a 502 and redacts credentials from the message', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(
        team._id,
        'http://user:s3cr3t@prom.example.com',
      );

      mockFetch.mockRejectedValueOnce(
        Object.assign(new Error('fetch failed'), {
          cause: { code: 'ECONNREFUSED' },
        }),
      );

      const res = await agent
        .get('/v1/prometheus/query_exemplars')
        .query({
          query: 'up',
          start: '1700000000',
          end: '1700000060',
          connectionId: conn._id.toString(),
        })
        .expect(502);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.body.error).toContain('ECONNREFUSED');
      expect(res.body.error).not.toContain('s3cr3t');
    });

    // nosniff is set by router middleware, so the helper's own error bodies —
    // which echo the caller-supplied host — carry it too.
    it('sends nosniff on its own error responses', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id, 'not-a-valid-url');

      const res = await agent
        .get('/v1/prometheus/query_exemplars')
        .query({
          query: 'up',
          start: '1700000000',
          end: '1700000060',
          connectionId: conn._id.toString(),
        })
        .expect(400);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('proxies to upstream Prometheus when connection isPrometheusEndpoint', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      const promResponse = {
        status: 'success',
        data: { resultType: 'matrix', result: [] },
      };
      mockFetch.mockResolvedValueOnce(fakeUpstreamResponse(promResponse));

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
          table: 'metrics_ts',
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
      mockFetch.mockResolvedValueOnce(fakeUpstreamResponse(promResponse));

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
      mockFetch.mockResolvedValueOnce(fakeUpstreamResponse(promResponse));

      const res = await agent
        .get('/v1/prometheus/label/__name__/values')
        .query({ connectionId: conn._id.toString() })
        .expect(200);

      expect(res.body).toEqual(promResponse);
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/api/v1/label/__name__/values');
    });
  });

  describe('GET /v1/prometheus/query_exemplars', () => {
    it('returns 400 when query parameter is missing', async () => {
      const { agent } = await getLoggedInAgent(server);
      const res = await agent
        .get('/v1/prometheus/query_exemplars')
        .query({ connectionId: new Types.ObjectId().toString() })
        .expect(400);
      expect(res.body).toMatchObject({
        status: 'error',
        errorType: 'bad_data',
        error: expect.stringContaining('query'),
      });
    });

    it('returns 400 when connectionId is missing', async () => {
      const { agent } = await getLoggedInAgent(server);
      const res = await agent
        .get('/v1/prometheus/query_exemplars')
        .query({ query: 'up' })
        .expect(400);
      expect(res.body).toMatchObject({
        status: 'error',
        errorType: 'bad_data',
        error: expect.stringContaining('connectionId'),
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns 404 for a connection owned by another team', async () => {
      const { agent } = await getLoggedInAgent(server);
      // A real, resolvable connection — just not this team's. The 404 must come
      // from the team scoping, not from the id simply not existing.
      const otherTeamConn = await seedPrometheusConnection(
        new Types.ObjectId(),
      );

      const res = await agent
        .get('/v1/prometheus/query_exemplars')
        .query({ query: 'up', connectionId: otherTeamConn._id.toString() })
        .expect(404);
      expect(res.body).toMatchObject({
        status: 'error',
        error: 'Connection not found',
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('proxies to upstream Prometheus when connection isPrometheusEndpoint', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      const promResponse = { status: 'success', data: [] };
      mockFetch.mockResolvedValueOnce(fakeUpstreamResponse(promResponse));

      const res = await agent
        .get('/v1/prometheus/query_exemplars')
        .query({
          query: 'up',
          start: '1700000000',
          end: '1700000060',
          connectionId: conn._id.toString(),
        })
        .expect(200);

      expect(res.body).toEqual(promResponse);
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/api/v1/query_exemplars');
      expect(calledUrl).toContain('query=up');
    });

    // The existing case above uses a 60-second window, where the Math.max in
    // resolveExemplarWindow is a no-op — so it would still pass if the narrowed
    // window never reached the outgoing URL. This drives a range wide enough for
    // the clamp to bite and inspects what was actually requested.
    it('narrows an over-wide window on the outgoing request and keeps end', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      mockFetch.mockResolvedValueOnce(
        fakeUpstreamResponse({ status: 'success', data: [] }),
      );

      const end = 1700000000;
      const thirtyDays = 30 * 24 * 60 * 60;

      await agent
        .get('/v1/prometheus/query_exemplars')
        .query({
          query: 'up',
          start: String(end - thirtyDays),
          end: String(end),
          connectionId: conn._id.toString(),
        })
        .expect(200);

      const requested = new URL(mockFetch.mock.calls[0][0] as string);
      const sentStart = Number(requested.searchParams.get('start'));
      expect(Number(requested.searchParams.get('end'))).toBe(end);
      expect(sentStart).toBeGreaterThan(end - thirtyDays);
      expect(end - sentStart).toBe(PROMETHEUS_MAX_EXEMPLAR_WINDOW_SEC);
    });

    it('returns an empty result for ClickHouse-backed connections (no native exemplar table function)', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedClickHouseConnection(team._id);

      const res = await agent
        .get('/v1/prometheus/query_exemplars')
        .query({
          query: 'up',
          start: '1700000000',
          end: '1700000060',
          connectionId: conn._id.toString(),
        })
        .expect(200);

      expect(res.body).toEqual({ status: 'success', data: [] });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    // The two backends have different required-parameter contracts on one route,
    // keyed on an attribute the caller does not control. That is deliberate — the
    // ClickHouse branch does no upstream work, so 400ing it would light up the
    // chart's exemplar error indicator on a healthy chart — but it is surprising
    // enough to pin rather than leave to a comment.
    it('validates start/end only on the branch that reaches Prometheus', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const prom = await seedPrometheusConnection(team._id);
      const ch = await seedClickHouseConnection(team._id);

      await agent
        .get('/v1/prometheus/query_exemplars')
        .query({
          query: 'up',
          start: 'not-a-time',
          connectionId: prom._id.toString(),
        })
        .expect(400);

      const res = await agent
        .get('/v1/prometheus/query_exemplars')
        .query({
          query: 'up',
          start: 'not-a-time',
          connectionId: ch._id.toString(),
        })
        .expect(200);

      expect(res.body).toEqual({ status: 'success', data: [] });
    });
  });
});
