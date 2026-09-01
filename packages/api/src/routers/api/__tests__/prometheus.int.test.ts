import { Types } from 'mongoose';

import * as config from '@/config';
import {
  DEFAULT_DATABASE,
  dropTimeSeriesTable,
  getAgent,
  getLoggedInAgent,
  getServer,
  seedTimeSeriesTagsTable,
} from '@/fixtures';
import Connection from '@/models/connection';
import { PROMETHEUS_MAX_EXEMPLAR_WINDOW_SEC } from '@/routers/api/prometheus';

const mockFetch = jest.mocked(global.fetch);

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
      const calledUrl = mockFetch.mock.calls[0][0];
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
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('/api/v1/query');
      expect(calledUrl).not.toContain('/api/v1/query_range');
    });
  });

  describe('GET /v1/prometheus/label/:name/values', () => {
    it('returns 400 when connectionId parameter is missing', async () => {
      const { agent } = await getLoggedInAgent(server);
      await agent.get('/v1/prometheus/label/__name__/values').expect(400);
    });

    // An empty or malformed id must fail in the schema. Reaching Mongoose
    // instead turns a client error into a cast failure that the handler's
    // catch-all reports as a backend fault.
    it.each(['', 'not-an-object-id'])(
      'returns 400 for connectionId %p',
      async connectionId => {
        const { agent } = await getLoggedInAgent(server);
        const res = await agent
          .get('/v1/prometheus/label/__name__/values')
          .query({ connectionId })
          .expect(400);

        expect(res.body).toMatchObject({
          status: 'error',
          errorType: 'bad_data',
          error: expect.stringContaining('connectionId'),
        });
      },
    );

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
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('/api/v1/label/__name__/values');
    });

    it('forwards normalized bounds upstream', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      await agent
        .get('/v1/prometheus/label/job/values')
        .query({
          connectionId: conn._id.toString(),
          start: '2023-11-14T22:13:20Z',
          end: '1700000060',
        })
        .expect(200);

      const requested = new URL(String(mockFetch.mock.calls[0][0]));
      expect(requested.searchParams.get('start')).toBe('1700000000');
      expect(requested.searchParams.get('end')).toBe('1700000060');
    });

    it('sends no bounds upstream when the caller gives none', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      await agent
        .get('/v1/prometheus/label/job/values')
        .query({ connectionId: conn._id.toString() })
        .expect(200);

      const requested = new URL(String(mockFetch.mock.calls[0][0]));
      expect(requested.searchParams.has('start')).toBe(false);
      expect(requested.searchParams.has('end')).toBe(false);
    });

    // `?start=` is what a client sends for "no bound"; it must not become the
    // epoch, which is what parseTimestamp('') -> Number('') would make it.
    it('treats an empty bound as absent rather than as the epoch', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      await agent
        .get('/v1/prometheus/label/job/values')
        .query({ connectionId: conn._id.toString(), start: '', end: '' })
        .expect(200);

      const requested = new URL(String(mockFetch.mock.calls[0][0]));
      expect(requested.searchParams.has('start')).toBe(false);
      expect(requested.searchParams.has('end')).toBe(false);
    });

    // Query-string values arrive as strings; a schema that only accepts numbers
    // would 400 every request carrying a limit.
    it('forwards limit upstream', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      await agent
        .get('/v1/prometheus/label/job/values')
        .query({ connectionId: conn._id.toString(), limit: '25' })
        .expect(200);

      const requested = new URL(String(mockFetch.mock.calls[0][0]));
      expect(requested.searchParams.get('limit')).toBe('25');
    });

    it('treats an empty limit as absent', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      await agent
        .get('/v1/prometheus/label/job/values')
        .query({ connectionId: conn._id.toString(), limit: '' })
        .expect(200);

      const requested = new URL(String(mockFetch.mock.calls[0][0]));
      expect(requested.searchParams.has('limit')).toBe(false);
    });

    // Prometheus reads limit=0 as unlimited, which is also what sending no
    // limit means. Rejecting it would break a caller Prometheus itself accepts.
    it('drops a zero limit and still proxies', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      await agent
        .get('/v1/prometheus/label/job/values')
        .query({ connectionId: conn._id.toString(), limit: '0' })
        .expect(200);

      const requested = new URL(String(mockFetch.mock.calls[0][0]));
      expect(requested.searchParams.has('limit')).toBe(false);
    });

    it('rejects a negative limit', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      await agent
        .get('/v1/prometheus/label/job/values')
        .query({ connectionId: conn._id.toString(), limit: '-1' })
        .expect(400);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects a non-numeric limit', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      await agent
        .get('/v1/prometheus/label/job/values')
        .query({ connectionId: conn._id.toString(), limit: 'lots' })
        .expect(400);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects a malformed bound before reaching upstream', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      const res = await agent
        .get('/v1/prometheus/label/job/values')
        .query({ connectionId: conn._id.toString(), start: 'not-a-time' })
        .expect(400);

      expect(res.body).toMatchObject({
        status: 'error',
        errorType: 'bad_data',
        error: 'start: invalid timestamp, expected RFC3339 or unix seconds',
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    // Upstream 400s on an inverted range, so rejecting it here keeps the two
    // backends answering the same request the same way.
    it('rejects an inverted range before reaching upstream', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      const res = await agent
        .get('/v1/prometheus/label/job/values')
        .query({
          connectionId: conn._id.toString(),
          start: '1700000000',
          end: '1600000000',
        })
        .expect(400);

      expect(res.body).toMatchObject({
        status: 'error',
        errorType: 'bad_data',
        error: 'end: end timestamp must not be before start time',
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    // `match[]` is how a client scopes label values to one metric; dropping it
    // silently widens the answer to every series in the store. Repeatable, and
    // forwarded verbatim — a selector is PromQL, which only upstream parses.
    it('forwards every match[] selector verbatim', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      await agent
        .get('/v1/prometheus/label/job/values')
        .query(
          `connectionId=${conn._id.toString()}&start=2023-11-14T22:13:20Z` +
            `&match[]=${encodeURIComponent('up{env="prod"}')}` +
            `&match[]=${encodeURIComponent('down')}`,
        )
        .expect(200);

      const requested = new URL(String(mockFetch.mock.calls[0][0]));
      expect(requested.searchParams.getAll('match[]')).toEqual([
        'up{env="prod"}',
        'down',
      ]);
      expect(requested.searchParams.getAll('start')).toEqual(['1700000000']);
    });

    // qs strips the brackets, so the unbracketed spelling arrives on the same
    // key. It still has to leave as `match[]`, which is the only name
    // Prometheus reads.
    it('restores the bracketed name for an unbracketed match', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      await agent
        .get('/v1/prometheus/label/job/values')
        .query({ connectionId: conn._id.toString(), match: 'up' })
        .expect(200);

      const requested = new URL(String(mockFetch.mock.calls[0][0]));
      expect(requested.searchParams.getAll('match[]')).toEqual(['up']);
      expect(requested.searchParams.has('match')).toBe(false);
    });

    it('treats an empty match as absent', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const conn = await seedPrometheusConnection(team._id);

      await agent
        .get('/v1/prometheus/label/job/values')
        .query({ connectionId: conn._id.toString(), match: '' })
        .expect(200);

      const requested = new URL(String(mockFetch.mock.calls[0][0]));
      expect(requested.searchParams.has('match[]')).toBe(false);
    });

    // queryLabelValues' own bounds/limit/fallback behaviour is covered in
    // controllers/__tests__/timeseriesEngine.int.test.ts. What only the route
    // can show is that query-string params reach it intact — bounds in unix
    // seconds where the controller takes milliseconds, and a stringified limit.
    describe('ClickHouse-backed', () => {
      const TABLE = 'prom_label_values_bounded_test';
      const OLD_METRIC = 'label_values_old_metric';
      const RECENT_METRIC = 'label_values_recent_metric';
      const OLD_START = 1600000000;
      const RECENT_START = 1700000000;
      const SERIES_LENGTH_SEC = 3600;

      const labelValues = async (query: Record<string, string>) => {
        const { agent, team } = await getLoggedInAgent(server);
        const conn = await seedClickHouseConnection(team._id);
        const res = await agent
          .get('/v1/prometheus/label/__name__/values')
          .query({
            connectionId: conn._id.toString(),
            database: DEFAULT_DATABASE,
            table: TABLE,
            ...query,
          })
          .expect(200);
        return res.body;
      };

      beforeAll(async () => {
        await seedTimeSeriesTagsTable({
          table: TABLE,
          series: [
            {
              metricName: OLD_METRIC,
              tags: { job: 'batch' },
              startSec: OLD_START,
              endSec: OLD_START + SERIES_LENGTH_SEC,
            },
            {
              metricName: RECENT_METRIC,
              tags: { job: 'api' },
              startSec: RECENT_START,
              endSec: RECENT_START + SERIES_LENGTH_SEC,
            },
          ],
        });
      });

      afterAll(async () => {
        await dropTimeSeriesTable({ table: TABLE });
      });

      it('returns every value when no bounds are given', async () => {
        expect(await labelValues({})).toEqual({
          status: 'success',
          data: [OLD_METRIC, RECENT_METRIC],
        });
      });

      // Bounds arrive in unix seconds. Passed through unscaled they land in
      // 1970, where the min_time predicate excludes every series instead.
      it('reads bounds as unix seconds', async () => {
        expect(
          await labelValues({
            start: String(RECENT_START),
            end: String(RECENT_START + SERIES_LENGTH_SEC),
          }),
        ).toEqual({ status: 'success', data: [RECENT_METRIC] });
      });

      // Without the range check this answers 200 with whatever series span the
      // inverted gap, while the proxy path 400s the identical request.
      it('rejects an inverted range instead of answering', async () => {
        const { agent, team } = await getLoggedInAgent(server);
        const conn = await seedClickHouseConnection(team._id);

        const res = await agent
          .get('/v1/prometheus/label/__name__/values')
          .query({
            connectionId: conn._id.toString(),
            database: DEFAULT_DATABASE,
            table: TABLE,
            start: String(RECENT_START),
            end: String(OLD_START),
          })
          .expect(400);

        expect(res.body).toMatchObject({
          status: 'error',
          errorType: 'bad_data',
          error: 'end: end timestamp must not be before start time',
        });
      });

      // A zero-width range is a point query, not an inversion.
      it('accepts equal bounds', async () => {
        expect(
          await labelValues({
            start: String(RECENT_START),
            end: String(RECENT_START),
          }),
        ).toEqual({ status: 'success', data: [RECENT_METRIC] });
      });

      it('honours a limit given as a query string', async () => {
        expect(await labelValues({ limit: '1' })).toEqual({
          status: 'success',
          data: [OLD_METRIC],
        });
      });

      it('reads a zero limit as unlimited', async () => {
        expect(await labelValues({ limit: '0' })).toEqual({
          status: 'success',
          data: [OLD_METRIC, RECENT_METRIC],
        });
      });

      // Nothing here evaluates a PromQL selector, so answering 200 with
      // unfiltered values would be a wrong answer the caller trusts.
      it('rejects match[] instead of ignoring it', async () => {
        const { agent, team } = await getLoggedInAgent(server);
        const conn = await seedClickHouseConnection(team._id);

        const res = await agent
          .get('/v1/prometheus/label/__name__/values')
          .query({
            connectionId: conn._id.toString(),
            database: DEFAULT_DATABASE,
            table: TABLE,
            'match[]': 'up',
          })
          .expect(400);

        expect(res.body).toMatchObject({
          status: 'error',
          errorType: 'bad_data',
          error:
            'match[] is not supported for ClickHouse-backed PromQL connections',
        });
      });
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
      const calledUrl = mockFetch.mock.calls[0][0];
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
