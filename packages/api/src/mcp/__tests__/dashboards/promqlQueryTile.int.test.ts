import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { DisplayType, SourceKind } from '@hyperdx/common-utils/dist/types';

import {
  DEFAULT_DATABASE,
  dropTimeSeriesTable,
  seedTimeSeriesTagsTable,
} from '@/fixtures';
import { callTool, getFirstText } from '@/mcp/__tests__/mcpTestUtils';
import Connection from '@/models/connection';
import Dashboard from '@/models/dashboard';
import { Source } from '@/models/source';

import { setupDashboardTests } from './setup';

const mockFetch = jest.mocked(global.fetch);
// Set by jest.setup.ts before it stubs `fetch`.
const realFetch: typeof fetch = globalThis.realFetch;

const TABLE = 'mcp_promql_query_tile';
const START = 1700000000;
const startTime = new Date(START * 1000).toISOString();
const endTime = new Date((START + 60) * 1000).toISOString();

describe('MCP query_tile - PromQL tiles', () => {
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

  const createDashboard = (
    sourceId: string,
    config: Record<string, unknown>,
    filters: Record<string, unknown>[] = [],
  ) =>
    new Dashboard({
      name: 'PromQL',
      tiles: [
        {
          id: 'promql-tile',
          x: 0,
          y: 0,
          w: 6,
          h: 3,
          config: {
            configType: 'promql',
            name: 'Up',
            displayType: DisplayType.Line,
            source: sourceId,
            granularity: '1 minute',
            ...config,
          },
        },
      ],
      filters,
      team: ctx.team._id,
    }).save();

  const queryTile = (dashboardId: string, args: Record<string, unknown> = {}) =>
    callTool(ctx.client!, 'clickstack_query_tile', {
      dashboardId,
      tileId: 'promql-tile',
      startTime,
      endTime,
      ...args,
    });

  const parseResult = (result: Awaited<ReturnType<typeof callTool>>) =>
    JSON.parse(getFirstText(result)).result;

  const lineTile = {
    promqlExpression: [{ expression: 'sum by (instance) (mcp_up)' }],
    legendTemplate: '{{instance}}',
  };

  const fetchedPaths = () =>
    mockFetch.mock.calls.map(([url]) => new URL(String(url)).pathname);

  it("returns a line tile's rows through ClickHouse's Prometheus API", async () => {
    mockFetch.mockImplementation(realFetch);
    const source = await createClickhouseSource();
    const dashboard = await createDashboard(source._id.toString(), lineTile);

    const result = await queryTile(dashboard._id.toString());

    expect(result.isError).toBeFalsy();
    const { data, seriesLabels } = parseResult(result);
    expect(Object.keys(seriesLabels).sort()).toEqual([
      'checkout-0',
      'checkout-1',
    ]);
    expect(seriesLabels['checkout-0']).toEqual({ instance: 'checkout-0' });
    expect(data.length).toBeGreaterThan(0);
    expect(data).toContainEqual({
      __hdx_time_bucket: '2023-11-14T22:14:00.000Z',
      series_name: 'checkout-0',
      value: 1,
    });
    expect(fetchedPaths()).toContain('/prometheus/api/v1/query_range');
  });

  it("runs every expression of a tile through ClickHouse's Prometheus API", async () => {
    mockFetch.mockImplementation(realFetch);
    const source = await createClickhouseSource();
    const dashboard = await createDashboard(source._id.toString(), {
      promqlExpression: [
        { expression: 'sum by (instance) (mcp_up)' },
        { expression: 'count(mcp_up)' },
      ],
    });

    const result = await queryTile(dashboard._id.toString());

    expect(result.isError ? getFirstText(result) : '').toBe('');
    const { data } = parseResult(result);
    const seriesNames = new Set(
      data.map((row: { series_name: string }) => row.series_name),
    );
    expect(seriesNames.size).toBe(3);
  });

  it('returns the same rows through the table function on ClickHouse < 26.6', async () => {
    jest
      .spyOn(Metadata.prototype, 'getServerVersion')
      .mockResolvedValue([26, 5, 0, 0]);
    const source = await createClickhouseSource();
    const dashboard = await createDashboard(source._id.toString(), lineTile);

    const result = await queryTile(dashboard._id.toString());

    expect(result.isError).toBeFalsy();
    expect(parseResult(result).data).toContainEqual({
      __hdx_time_bucket: '2023-11-14T22:14:00.000Z',
      series_name: 'checkout-0',
      value: 1,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reduces a number tile to one value', async () => {
    mockFetch.mockImplementation(realFetch);
    const source = await createClickhouseSource();
    const dashboard = await createDashboard(source._id.toString(), {
      displayType: DisplayType.Number,
      promqlExpression: [{ expression: 'count(mcp_up)', queryType: 'instant' }],
    });

    const result = await queryTile(dashboard._id.toString());

    expect(result.isError).toBeFalsy();
    expect(parseResult(result).data).toEqual([
      { series_name: 'count(mcp_up)', value: 2 },
    ]);
  });

  it('applies the selected dashboard variable', async () => {
    mockFetch.mockImplementation(realFetch);
    const source = await createClickhouseSource();
    const dashboard = await createDashboard(
      source._id.toString(),
      {
        ...lineTile,
        promqlExpression: [
          {
            expression: 'sum by (instance) (mcp_up{instance=~"$instance"})',
          },
        ],
      },
      [
        {
          id: 'instance-filter',
          type: 'PROMETHEUS_LABEL',
          name: 'instance',
          variableName: 'instance',
          source: source._id.toString(),
          label: 'instance',
          isBroadcastEnabled: false,
          isVariableEnabled: true,
        },
      ],
    );

    const result = await queryTile(dashboard._id.toString(), {
      variableValues: [{ name: 'instance', values: ['checkout-1'] }],
    });

    expect(result.isError).toBeFalsy();
    expect(Object.keys(parseResult(result).seriesLabels)).toEqual([
      'checkout-1',
    ]);
  });

  it('queries a Prometheus endpoint with the host credentials and no table params', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'success',
          data: {
            resultType: 'matrix',
            result: [
              { metric: { instance: 'checkout-0' }, values: [[START, '1']] },
            ],
          },
        }),
      ),
    );
    const source = await createPrometheusSource();
    const dashboard = await createDashboard(source._id.toString(), lineTile);

    const result = await queryTile(dashboard._id.toString());

    expect(result.isError).toBeFalsy();
    expect(parseResult(result).data).toEqual([
      {
        __hdx_time_bucket: '2023-11-14T22:13:20.000Z',
        series_name: 'checkout-0',
        value: 1,
      },
    ]);
    const [url, init] = mockFetch.mock.calls[0];
    const requested = new URL(String(url));
    expect(`${requested.origin}${requested.pathname}`).toBe(
      'http://prom.example.com/api/v1/query_range',
    );
    expect(requested.searchParams.has('database')).toBe(false);
    expect(requested.searchParams.has('table')).toBe(false);
    expect(init?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('user:secret').toString('base64')}`,
    });
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
    const dashboard = await createDashboard(source._id.toString(), lineTile);

    const result = await queryTile(dashboard._id.toString());

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('parse error');
  });

  it('reports an unreachable endpoint without its credentials', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
    const source = await createPrometheusSource();
    const dashboard = await createDashboard(source._id.toString(), lineTile);

    const result = await queryTile(dashboard._id.toString());

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain(
      'Failed to reach Prometheus at http://prom.example.com/api/v1/query_range',
    );
    expect(getFirstText(result)).not.toContain('secret');
  });

  it('reports a PromQL tile with data in query_tiles', async () => {
    mockFetch.mockImplementation(realFetch);
    const source = await createClickhouseSource();
    const dashboard = await createDashboard(source._id.toString(), lineTile);

    const result = await callTool(ctx.client!, 'clickstack_query_tiles', {
      dashboardId: dashboard._id.toString(),
      startTime,
      endTime,
    });

    expect(result.isError).toBeFalsy();
    const { tiles } = JSON.parse(getFirstText(result));
    expect(tiles).toEqual([
      expect.objectContaining({
        tileId: 'promql-tile',
        status: 'ok',
        hasData: true,
      }),
    ]);
  });

  it('does not find a PromQL tile with PromQL disabled', async () => {
    await ctx.reconnect({ promqlEnabled: false });
    const source = await createClickhouseSource();
    const dashboard = await createDashboard(source._id.toString(), lineTile);

    const result = await queryTile(dashboard._id.toString());

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('Tile not found');
  });
});
