import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import { PROMETHEUS_MAX_RESPONSE_BYTES } from '@/controllers/promql';
import {
  DEFAULT_DATABASE,
  dropTimeSeriesTable,
  seedTimeSeriesTagsTable,
} from '@/fixtures';
import { setupDashboardTests } from '@/mcp/__tests__/dashboards/setup';
import { callTool, getFirstText } from '@/mcp/__tests__/mcpTestUtils';
import Connection from '@/models/connection';
import { Source } from '@/models/source';

const mockFetch = jest.mocked(global.fetch);
// Set by jest.setup.ts before it stubs `fetch`.
const realFetch: typeof fetch = globalThis.realFetch;

const TABLE = 'mcp_promql_query_tool';
const START = 1700000000;
const startTime = new Date(START * 1000).toISOString();
const endTime = new Date((START + 60) * 1000).toISOString();

const prometheusResponse = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify({ status: 'success', data }), init);

describe('MCP clickstack_promql', () => {
  const ctx = setupDashboardTests();

  beforeAll(async () => {
    await seedTimeSeriesTagsTable({
      table: TABLE,
      series: ['checkout-0', 'checkout-1'].map(instance => ({
        metricName: 'mcp_up',
        tags: { job: 'checkout', instance },
        startSec: START,
        endSec: START + 60,
      })),
      withSamples: true,
    });
  });

  afterAll(async () => {
    await dropTimeSeriesTable({ table: TABLE });
  });

  beforeEach(() => ctx.reconnect({ promqlEnabled: true }));

  afterEach(() => {
    jest.restoreAllMocks();
    mockFetch.mockReset();
  });

  const createClickhouseSource = () =>
    Source.create({
      kind: SourceKind.Promql,
      team: ctx.team._id,
      connection: ctx.connection._id,
      name: 'Metrics',
      from: { databaseName: DEFAULT_DATABASE, tableName: TABLE },
      timestampValueExpression: 'timestamp',
    });

  const createPrometheusSource = async () => {
    const connection = await Connection.create({
      team: ctx.team._id,
      name: 'Prom',
      host: 'http://user:secret@prom.example.com',
      username: '',
      password: '',
      isPrometheusEndpoint: true,
    });
    return Source.create({
      kind: SourceKind.Promql,
      team: ctx.team._id,
      connection: connection._id,
      name: 'Prometheus',
      from: { databaseName: 'prometheus', tableName: 'prometheus' },
      timestampValueExpression: 'timestamp',
    });
  };

  const promql = (args: Record<string, unknown>) =>
    callTool(ctx.client!, 'clickstack_promql', {
      expression: 'sum by (instance) (mcp_up)',
      startTime,
      endTime,
      ...args,
    });

  const parseResult = (result: Awaited<ReturnType<typeof callTool>>) =>
    JSON.parse(getFirstText(result)).result;

  const requestedUrls = () =>
    mockFetch.mock.calls.map(([url]) => new URL(String(url)));

  it('returns time series rows and seriesLabels for a range query', async () => {
    mockFetch.mockImplementation(realFetch);
    const source = await createClickhouseSource();

    const result = await promql({
      sourceId: source._id.toString(),
      granularity: '1 minute',
    });

    expect(result.isError ? getFirstText(result) : '').toBe('');
    const { data, seriesLabels } = parseResult(result);
    expect(seriesLabels).toEqual({
      '{instance="checkout-0"}': { instance: 'checkout-0' },
      '{instance="checkout-1"}': { instance: 'checkout-1' },
    });
    expect(data).toContainEqual({
      __hdx_time_bucket: '2023-11-14T22:14:00.000Z',
      series_name: '{instance="checkout-0"}',
      value: 1,
    });
    const requested = requestedUrls().find(url =>
      url.pathname.endsWith('/query_range'),
    );
    expect(requested?.searchParams.get('step')).toBe('60');
  });

  it('picks the auto step when granularity is omitted', async () => {
    mockFetch.mockImplementation(realFetch);
    const source = await createClickhouseSource();

    const result = await promql({ sourceId: source._id.toString() });

    expect(result.isError).toBeFalsy();
    const requested = requestedUrls().find(url =>
      url.pathname.endsWith('/query_range'),
    );
    expect(Number(requested?.searchParams.get('step'))).toBeGreaterThan(0);
  });

  it('returns one row per series with a column per label for an instant query', async () => {
    mockFetch.mockImplementation(realFetch);
    const source = await createClickhouseSource();

    const result = await promql({
      sourceId: source._id.toString(),
      expression: 'mcp_up',
      queryType: 'instant',
    });

    expect(result.isError ? getFirstText(result) : '').toBe('');
    const { data, meta } = parseResult(result);
    expect(data).toHaveLength(2);
    expect(data).toContainEqual(
      expect.objectContaining({
        instance: 'checkout-0',
        job: 'checkout',
        Value: 1,
      }),
    );
    expect(meta.map((column: { name: string }) => column.name)).not.toContain(
      '__hdx_time_bucket',
    );
    const paths = requestedUrls().map(url => url.pathname);
    expect(paths).toContain('/prometheus/api/v1/query');
    expect(paths).not.toContain('/prometheus/api/v1/query_range');
  });

  it('returns the same rows through the table function on ClickHouse < 26.6', async () => {
    jest
      .spyOn(Metadata.prototype, 'getServerVersion')
      .mockResolvedValue([26, 5, 0, 0]);
    const source = await createClickhouseSource();

    const result = await promql({
      sourceId: source._id.toString(),
      granularity: '1 minute',
    });

    expect(result.isError).toBeFalsy();
    expect(parseResult(result).data).toContainEqual({
      __hdx_time_bucket: '2023-11-14T22:14:00.000Z',
      series_name: '{instance="checkout-0"}',
      value: 1,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('queries a Prometheus endpoint with the host credentials and no table params', async () => {
    mockFetch.mockResolvedValueOnce(
      prometheusResponse({
        resultType: 'matrix',
        result: [
          { metric: { instance: 'checkout-0' }, values: [[START, '1']] },
        ],
      }),
    );
    const source = await createPrometheusSource();

    const result = await promql({ sourceId: source._id.toString() });

    expect(result.isError).toBeFalsy();
    // A lone series has no distinguishing label, so it is named after the
    // expression.
    expect(parseResult(result).data).toEqual([
      {
        __hdx_time_bucket: '2023-11-14T22:13:20.000Z',
        series_name: 'sum by (instance) (mcp_up)',
        value: 1,
      },
    ]);
    const [url, init] = mockFetch.mock.calls[0];
    const requested = new URL(String(url));
    expect(`${requested.origin}${requested.pathname}`).toBe(
      'http://prom.example.com/api/v1/query_range',
    );
    expect(requested.searchParams.get('query')).toBe(
      'sum by (instance) (mcp_up)',
    );
    expect(requested.searchParams.has('database')).toBe(false);
    expect(requested.searchParams.has('table')).toBe(false);
    expect(init?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('user:secret').toString('base64')}`,
    });
  });

  it('expands the PromQL macros before sending the expression', async () => {
    mockFetch.mockResolvedValueOnce(
      prometheusResponse({ resultType: 'matrix', result: [] }),
    );
    const source = await createPrometheusSource();

    await promql({
      sourceId: source._id.toString(),
      expression:
        'rate(mcp_up[$__rate_interval]) and avg_over_time(mcp_up[$__interval])',
      granularity: '1 minute',
    });

    const sent = requestedUrls()[0].searchParams.get('query');
    expect(sent).not.toContain('$__');
    expect(sent).toContain('avg_over_time(mcp_up[60s])');
  });

  it('sets $__interval from granularity in an instant query too', async () => {
    mockFetch.mockResolvedValueOnce(
      prometheusResponse({ resultType: 'vector', result: [] }),
    );
    const source = await createPrometheusSource();

    await promql({
      sourceId: source._id.toString(),
      expression: 'avg_over_time(mcp_up[$__interval])',
      queryType: 'instant',
      granularity: '5 minute',
    });

    const requested = requestedUrls()[0];
    expect(requested.pathname).toBe('/api/v1/query');
    expect(requested.searchParams.get('query')).toBe(
      'avg_over_time(mcp_up[300s])',
    );
  });

  it('rejects a sourceId that is not an ObjectId as a schema error', async () => {
    const result = await promql({ sourceId: 'Metrics' });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('Invalid ObjectId');
    expect(getFirstText(result)).toContain('sourceId');
  });

  it('rejects an unknown source and a source that is not PromQL', async () => {
    const unknown = await promql({ sourceId: '000000000000000000000001' });
    expect(unknown.isError).toBe(true);
    expect(getFirstText(unknown)).toContain('Source not found');
    expect(getFirstText(unknown)).toContain('clickstack_list_sources');

    const trace = await promql({ sourceId: ctx.traceSource._id.toString() });
    expect(trace.isError).toBe(true);
    expect(getFirstText(trace)).toContain('Source not found');
  });

  it("returns the endpoint's error for a rejected expression", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'error',
          errorType: 'bad_data',
          error: 'parse error: unexpected end of input',
        }),
        { status: 400 },
      ),
    );
    const source = await createPrometheusSource();

    const result = await promql({ sourceId: source._id.toString() });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('parse error');
  });

  it('reports an unreachable endpoint without its credentials', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
    const source = await createPrometheusSource();

    const result = await promql({ sourceId: source._id.toString() });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain(
      'Failed to reach Prometheus at http://prom.example.com/api/v1/query_range',
    );
    expect(getFirstText(result)).not.toContain('secret');
  });

  it('reports a response too large to buffer as a server error', async () => {
    mockFetch.mockResolvedValueOnce(
      prometheusResponse(
        { resultType: 'matrix', result: [] },
        {
          headers: {
            'content-length': String(PROMETHEUS_MAX_RESPONSE_BYTES + 1),
          },
        },
      ),
    );
    const source = await createPrometheusSource();

    const result = await promql({ sourceId: source._id.toString() });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain(
      'returned more than 8 MB. Narrow the query or time range.',
    );
  });

  it('rejects a result a chart cannot draw as a user error', async () => {
    mockFetch.mockResolvedValueOnce(
      prometheusResponse({ resultType: 'string', result: [START, 'hello'] }),
    );
    const source = await createPrometheusSource();

    const result = await promql({
      sourceId: source._id.toString(),
      expression: '"hello"',
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('returned a string');
  });

  it('rejects a range query over the Prometheus resolution cap before querying', async () => {
    const source = await createPrometheusSource();

    const result = await promql({
      sourceId: source._id.toString(),
      granularity: '1 second',
      startTime: new Date((START - 86_400) * 1000).toISOString(),
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('exceeded maximum resolution');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('is not registered with PromQL disabled', async () => {
    await ctx.reconnect({ promqlEnabled: false });
    const source = await createClickhouseSource();

    const { tools } = await ctx.client!.listTools();
    expect(tools.map(tool => tool.name)).not.toContain('clickstack_promql');
    const result = await promql({ sourceId: source._id.toString() });
    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('Tool clickstack_promql not found');
  });
});
