import {
  BuilderChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';

import {
  buildNetflowSankeyConfig,
  buildNetflowSankeyData,
  SankeyDimension,
} from '@/netflowSankey';

const dimensions: SankeyDimension[] = [
  { key: 'source', label: 'Source IP', expression: 'SrcAddr' },
  {
    key: 'exporter',
    label: 'Exporter',
    expression: "coalesce(router, 'unknown')",
  },
  { key: 'destination', label: 'Destination IP', expression: 'DstAddr' },
];
const baseConfig: BuilderChartConfigWithDateRange = {
  source: 'flows',
  connection: 'connection',
  from: { databaseName: 'default', tableName: 'flows' },
  timestampValueExpression: 'TimeReceived',
  dateRange: [
    new Date('2026-10-09T10:00:00Z'),
    new Date('2026-10-09T11:00:00Z'),
  ],
  where: 'Proto:6 OR Proto:17',
  whereLanguage: 'lucene',
  filters: [{ type: 'sql', condition: "ExporterName NOT IN ('offline')" }],
  dateRangeEndInclusive: false,
  displayType: DisplayType.Number,
  select: [
    {
      valueExpression: 'sum(toFloat64(Bytes) * (SamplingRate))',
      alias: '__netflow_value',
    },
  ],
};

describe('NetFlow Sankey query', () => {
  it('preserves source, filters, time range, and sampled byte aggregation', () => {
    const config = buildNetflowSankeyConfig({
      baseConfig,
      dimensions,
      limit: 30,
    });
    expect(config).toMatchObject({
      source: baseConfig.source,
      connection: baseConfig.connection,
      from: baseConfig.from,
      dateRange: baseConfig.dateRange,
      timestampValueExpression: 'TimeReceived',
      where: baseConfig.where,
      whereLanguage: 'lucene',
      filters: baseConfig.filters,
      dateRangeEndInclusive: false,
      displayType: DisplayType.Table,
      groupBy:
        '__netflow_dimension_0, __netflow_dimension_1, __netflow_dimension_2',
      orderBy: '__netflow_value DESC',
      limit: { limit: 30 },
    });
    expect(config.select).toEqual([
      {
        valueExpression: "ifNull(toString(SrcAddr), '')",
        alias: '__netflow_dimension_0',
      },
      {
        valueExpression: "ifNull(toString(coalesce(router, 'unknown')), '')",
        alias: '__netflow_dimension_1',
      },
      {
        valueExpression: "ifNull(toString(DstAddr), '')",
        alias: '__netflow_dimension_2',
      },
      {
        valueExpression: 'sum(toFloat64(Bytes) * (SamplingRate))',
        alias: '__netflow_value',
      },
    ]);
    expect(baseConfig.select).toHaveLength(1);
    expect(baseConfig).not.toHaveProperty('groupBy');
  });

  it.each([
    [undefined, 20],
    [NaN, 20],
    [Infinity, 20],
    [-5, 1],
    [0, 1],
    [101, 100],
    [2.9, 2],
  ])('bounds the requested path limit %s to %s', (limit, expected) => {
    expect(
      buildNetflowSankeyConfig({ baseConfig, dimensions, limit }).limit,
    ).toEqual({ limit: expected });
  });

  it('rejects queries without a path or a byte aggregate', () => {
    expect(() =>
      buildNetflowSankeyConfig({ baseConfig, dimensions: [] }),
    ).toThrow();
    expect(() =>
      buildNetflowSankeyConfig({ baseConfig, dimensions: [dimensions[0]] }),
    ).toThrow();
    expect(() =>
      buildNetflowSankeyConfig({
        baseConfig,
        dimensions: [dimensions[0], { ...dimensions[1], expression: ' ' }],
      }),
    ).toThrow();
    expect(() =>
      buildNetflowSankeyConfig({
        baseConfig: { ...baseConfig, select: '*' },
        dimensions,
      }),
    ).toThrow();
  });
});

describe('NetFlow Sankey data', () => {
  const row = (values: unknown[], value: unknown) => ({
    ...Object.fromEntries(
      values.map((v, i) => [`__netflow_dimension_${i}`, v]),
    ),
    __netflow_value: value,
  });

  it('aggregates converging links and conserves sampled bytes at every stage', () => {
    const data = buildNetflowSankeyData(
      [
        row(['a', 'router', 'x'], '1000'),
        row(['b', 'router', 'x'], 2000),
        row(['a', 'router', 'y'], 4000),
      ],
      dimensions,
    );
    expect(data.totalBytes).toBe(7000);
    expect(data.paths.map(path => path.value)).toEqual([1000, 2000, 4000]);
    expect(data.links).toHaveLength(4);
    for (const stage of [0, 1]) {
      expect(
        data.links
          .filter(link => data.nodes[link.source].stage === stage)
          .reduce((total, link) => total + link.value, 0),
      ).toBe(7000);
    }
    expect(
      data.links.find(link => data.nodes[link.target].rawValue === 'x')?.value,
    ).toBe(3000);
    expect(
      data.links.find(link => data.nodes[link.source].rawValue === 'a')?.value,
    ).toBe(5000);
  });

  it('keeps repeated labels distinct across stages without cycles', () => {
    const data = buildNetflowSankeyData(
      [row(['same', 'same', 'same'], 5)],
      dimensions,
    );
    expect(new Set(data.nodes.map(node => node.id)).size).toBe(3);
    expect(data.links).toEqual([
      { source: 0, target: 1, value: 5 },
      { source: 1, target: 2, value: 5 },
    ]);
    expect(data.nodes.map(node => node.dimension)).toEqual(dimensions);
  });

  it('keeps empty raw values separate from the literal empty display label', () => {
    const data = buildNetflowSankeyData(
      [row(['', null, '(empty)'], 5)],
      dimensions,
    );
    expect(data.paths[0].values).toEqual(['', '', '(empty)']);
    expect(data.nodes.map(node => node.name)).toEqual([
      '(empty)',
      '(empty)',
      '(empty)',
    ]);
    expect(data.nodes.map(node => node.rawValue)).toEqual(['', '', '(empty)']);
  });

  it('ignores invalid counters, nonpositive paths, and rows missing a dimension', () => {
    const rows = [NaN, Infinity, -1, 0, '', null, true, 'bad'].map(value =>
      row(['a', 'b', 'c'], value),
    );
    rows.push(row(['missing'], 5));
    expect(buildNetflowSankeyData(rows, dimensions)).toEqual({
      nodes: [],
      links: [],
      paths: [],
      totalBytes: 0,
    });
    expect(buildNetflowSankeyData([], dimensions).totalBytes).toBe(0);
    expect(buildNetflowSankeyData([row(['a'], 5)], []).nodes).toEqual([]);
  });
});
