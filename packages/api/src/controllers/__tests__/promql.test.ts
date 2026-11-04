import {
  buildPrometheusRequest,
  PROMETHEUS_MAX_RESPONSE_BYTES,
  runPromqlQuery,
} from '@/controllers/promql';

const mockFetch = jest.mocked(global.fetch);

const respond = (status: number, body: unknown) =>
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status }),
  );

const matrix = {
  resultType: 'matrix',
  result: [{ metric: { job: 'api' }, values: [[1700000000, '1']] }],
};

const prometheus = { kind: 'prometheus' as const, host: 'http://prom:9090' };
const range = {
  kind: 'range' as const,
  expr: 'up',
  startSec: 1700000000,
  endSec: 1700003600,
  stepSec: 60,
};

const requestedUrl = () => new URL(String(mockFetch.mock.calls[0][0]));

describe('buildPrometheusRequest', () => {
  const host =
    'http://user:p%40ss@vm:8481/select/0/prometheus?extra_label=env%3Dprod&limit=50&step=15s';

  it('replaces host-pinned params it sets and keeps the rest', () => {
    const { url } = buildPrometheusRequest(host, '/api/v1/query_range', {
      step: '60',
      'match[]': ['up', 'down'],
      limit: [],
    });

    const sent = new URL(url);
    expect(`${sent.origin}${sent.pathname}`).toBe(
      'http://vm:8481/select/0/prometheus/api/v1/query_range',
    );
    expect(sent.searchParams.get('extra_label')).toBe('env=prod');
    expect(sent.searchParams.getAll('step')).toEqual(['60']);
    expect(sent.searchParams.getAll('match[]')).toEqual(['up', 'down']);
    expect(sent.searchParams.has('limit')).toBe(false);
  });

  it('moves host credentials into a Basic auth header next to the given headers', () => {
    const { url, headers, redactedTarget } = buildPrometheusRequest(
      host,
      '/api/v1/query',
      {},
      { 'X-Extra': '1' },
    );

    expect(url).not.toContain('user');
    expect(headers).toEqual({
      Authorization: `Basic ${Buffer.from('user:p@ss').toString('base64')}`,
      'X-Extra': '1',
    });
    expect(redactedTarget).toBe(
      'http://vm:8481/select/0/prometheus/api/v1/query',
    );
  });

  it('throws on a host that is not http(s)', () => {
    expect(() =>
      buildPrometheusRequest('prometheus:9090', '/api/v1/query', {}),
    ).toThrow(/http\(s\)/);
  });
});

describe('runPromqlQuery', () => {
  afterEach(() => {
    mockFetch.mockReset();
  });

  it('sends a range query to a Prometheus endpoint and returns its data', async () => {
    respond(200, { status: 'success', data: matrix });

    await expect(runPromqlQuery(prometheus, range)).resolves.toEqual(matrix);

    const url = requestedUrl();
    expect(`${url.origin}${url.pathname}`).toBe(
      'http://prom:9090/api/v1/query_range',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: 'up',
      start: '1700000000',
      end: '1700003600',
      step: '60',
    });
  });

  const clickhouseHttp = {
    kind: 'clickhouse-http' as const,
    connection: { host: 'http://ch:8123', username: 'default', password: 'pw' },
    databaseName: 'default',
    tableName: 'metrics',
  };
  const instant = { kind: 'instant' as const, expr: 'up', timeSec: 1700000000 };
  const emptyVector = {
    status: 'success',
    data: { resultType: 'vector', result: [] },
  };

  it("sends an instant query to ClickHouse's Prometheus API with the table, limits and credentials", async () => {
    respond(200, emptyVector);

    await runPromqlQuery(clickhouseHttp, instant);

    const url = requestedUrl();
    expect(url.pathname).toBe('/prometheus/api/v1/query');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      max_execution_time: '30',
      max_result_rows: '100000',
      query: 'up',
      time: '1700000000',
      database: 'default',
      table: 'metrics',
    });
    expect(mockFetch.mock.calls[0][1]?.headers).toMatchObject({
      'X-ClickHouse-User': 'default',
      'X-ClickHouse-Key': 'pw',
    });
  });

  it('gives each query on one ClickHouse backend its own query ID', async () => {
    respond(200, emptyVector);
    respond(200, emptyVector);

    await Promise.all([
      runPromqlQuery(clickhouseHttp, instant),
      runPromqlQuery(clickhouseHttp, instant),
    ]);

    const queryIds = mockFetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('X-ClickHouse-Query-Id'),
    );
    expect(queryIds[0]).toBeTruthy();
    expect(queryIds[0]).not.toBe(queryIds[1]);
  });

  it('reports a rejected expression as a user error', async () => {
    respond(400, {
      status: 'error',
      errorType: 'bad_data',
      error: 'parse error: unexpected end of input',
    });

    await expect(runPromqlQuery(prometheus, range)).rejects.toMatchObject({
      message: 'parse error: unexpected end of input',
      category: 'user',
    });
  });

  it.each([
    ['a 5xx', 503, 'internal'],
    ['a timeout', 400, 'timeout'],
  ])('reports %s as a server error', async (_, status, errorType) => {
    respond(status, { status: 'error', errorType, error: 'failed' });

    await expect(runPromqlQuery(prometheus, range)).rejects.toMatchObject({
      category: 'server',
    });
  });

  it('reports an unreachable endpoint as a server error, without its credentials', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(
      runPromqlQuery({ ...prometheus, host: 'http://u:p@prom:9090' }, range),
    ).rejects.toMatchObject({
      message:
        'Failed to reach Prometheus at http://prom:9090/api/v1/query_range',
      category: 'server',
    });
  });

  it('rejects a range query over the resolution cap before sending it', async () => {
    await expect(
      runPromqlQuery(prometheus, { ...range, stepSec: 0.1 }),
    ).rejects.toMatchObject({ category: 'user' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  describe('response size cap', () => {
    it('reports a response over the cap as a server error naming the cap', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{', {
          headers: {
            'content-length': String(PROMETHEUS_MAX_RESPONSE_BYTES + 1),
          },
        }),
      );

      await expect(runPromqlQuery(prometheus, range)).rejects.toMatchObject({
        message:
          'Prometheus at http://prom:9090/api/v1/query_range returned more than 8 MB. Narrow the query or time range.',
        category: 'server',
      });
    });

    it('reads a chunked body under the cap as before', async () => {
      const json = JSON.stringify({ status: 'success', data: matrix });
      const [head, tail] = [json.slice(0, 10), json.slice(10)];
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(head));
          controller.enqueue(new TextEncoder().encode(tail));
          controller.close();
        },
      });
      mockFetch.mockResolvedValueOnce(new Response(body));

      await expect(runPromqlQuery(prometheus, range)).resolves.toEqual(matrix);
    });

    it('reports a body that is not JSON by its HTTP status', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('<html>Bad gateway</html>', { status: 502 }),
      );

      await expect(runPromqlQuery(prometheus, range)).rejects.toMatchObject({
        message:
          'Prometheus at http://prom:9090/api/v1/query_range returned HTTP 502',
        category: 'server',
      });
    });
  });
});
