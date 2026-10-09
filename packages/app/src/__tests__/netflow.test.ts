import { Granularity } from '@hyperdx/common-utils/dist/core/utils';
import {
  DisplayType,
  SourceKind,
  TNetflowSource,
} from '@hyperdx/common-utils/dist/types';

import { buildAlertChartConfig } from '@/components/alerts/AlertDetailChart';
import { convertFormStateToChartConfig } from '@/components/ChartEditor/utils';
import { buildReleaseChartConfig } from '@/hooks/useReleaseAnnotations';
import { buildNetflowQueryConfigs, buildNetflowWhere } from '@/netflow';

const source: TNetflowSource = {
  id: 'flows',
  name: 'Network',
  kind: SourceKind.Netflow,
  connection: 'local',
  from: { databaseName: 'netflow_demo', tableName: 'flows' },
  timestampValueExpression: 'TimeReceived',
  defaultTableSelectExpression: '*',
  bytesExpression: 'Bytes',
  packetsExpression: 'Packets',
  samplingRateExpression: 'SamplingRate',
  srcAddrExpression: 'SrcAddr',
  dstAddrExpression: 'DstAddr',
  srcPortExpression: 'SrcPort',
  dstPortExpression: 'DstPort',
  protocolExpression: 'Proto',
  exporterExpression: 'ExporterName',
  inIfExpression: 'InIfName',
  outIfExpression: 'OutIfName',
};
const dateRange: [Date, Date] = [
  new Date('2026-10-09T12:00:00Z'),
  new Date('2026-10-09T13:00:00Z'),
];

describe('NetFlow queries', () => {
  it.each([
    ['TimeReceived, FlowDate', 'TimeReceived'],
    [
      "toDateTime(TimeReceived, 'UTC'), toDate(TimeReceived)",
      "toDateTime(TimeReceived, 'UTC')",
    ],
  ])(
    'uses the first timestamp expression for flow rows (%s)',
    (mapping, timestamp) => {
      const configs = buildNetflowQueryConfigs({
        source: { ...source, timestampValueExpression: mapping },
        dateRange,
        filters: {},
      });
      expect(configs.flows.select[0]).toEqual({
        valueExpression: timestamp,
        alias: '__netflow_timestamp',
      });
      expect(configs.flows.orderBy).toBe(`${timestamp} DESC`);
      expect(configs.flows.timestampValueExpression).toBe(mapping);
      expect(configs.traffic.timestampValueExpression).toBe(mapping);
    },
  );

  it('normalizes partial traffic buckets without expanding the selected range', () => {
    const selectedRange: [Date, Date] = [
      new Date('2026-10-09T12:00:30Z'),
      new Date('2026-10-09T13:00:20Z'),
    ];
    const configs = buildNetflowQueryConfigs({
      source,
      dateRange: selectedRange,
      filters: {},
    });
    expect(configs.traffic).toMatchObject({
      dateRange: selectedRange,
      alignDateRangeToGranularity: false,
    });
    expect(configs.traffic.select).toEqual([
      {
        alias: 'Bits per second',
        valueExpression: expect.stringMatching(/least\(.*greatest\(/),
      },
    ]);
    expect(configs.summary.dateRange).toEqual(selectedRange);
  });

  it('estimates sampled traffic but counts stored flow records', () => {
    const configs = buildNetflowQueryConfigs({
      source,
      dateRange,
      filters: {},
    });
    expect(configs.flows.select).toContainEqual({
      valueExpression: 'if((SamplingRate) > 0, (SamplingRate), 1)',
      alias: '__netflow_samplingRate',
    });
    expect(configs.summary.select).toEqual([
      {
        valueExpression:
          'sum(toFloat64(Bytes) * (if((SamplingRate) > 0, (SamplingRate), 1))) * 8 / 3600',
        alias: '__netflow_bitsPerSecond',
      },
      {
        valueExpression:
          'sum(toFloat64(Packets) * (if((SamplingRate) > 0, (SamplingRate), 1))) / 3600',
        alias: '__netflow_packetsPerSecond',
      },
      {
        valueExpression:
          'sum(toFloat64(Bytes) * (if((SamplingRate) > 0, (SamplingRate), 1)))',
        alias: '__netflow_bytes',
      },
      { valueExpression: 'count()', alias: '__netflow_flowRecords' },
    ]);
    expect(configs.traffic.select).toEqual([
      {
        valueExpression: expect.stringContaining(
          'sum(toFloat64(Bytes) * (if((SamplingRate) > 0, (SamplingRate), 1))) * 8 /',
        ),
        alias: 'Bits per second',
      },
    ]);
  });

  it.each([undefined, '   '])(
    'supports empty optional mappings (%s)',
    blank => {
      const configs = buildNetflowQueryConfigs({
        source: {
          ...source,
          samplingRateExpression: blank,
          exporterExpression: blank,
          inIfExpression: blank,
          outIfExpression: blank,
        },
        dateRange,
        filters: {},
      });
      expect(configs.totalBytes.select).toEqual([
        {
          valueExpression: 'sum(toFloat64(Bytes) * (1))',
          alias: '__netflow_value',
        },
      ]);
      expect(configs.exporters).toBeUndefined();
      expect(configs.inInterfaces).toBeUndefined();
      expect(configs.outInterfaces).toBeUndefined();
    },
  );

  it('normalizes IPv4 and IPv6 filters and quotes user values', () => {
    const where = buildNetflowWhere(source, {
      srcAddr: '192.0.2.1',
      dstAddr: '2001:db8::1',
      exporter: "edge\\' OR 1=1 --",
      protocol: '6',
    });
    expect(where).toContain(
      "toIPv6OrNull(toString(SrcAddr)) = toIPv6OrNull('192.0.2.1')",
    );
    expect(where).toContain(
      "toIPv6OrNull(toString(DstAddr)) = toIPv6OrNull('2001:db8::1')",
    );
    expect(where).toContain("'edge\\\\'' OR 1=1 --'");
    expect(where).toContain("toString(Proto) = '6'");
  });

  it('keeps the source, connection, time range and filters on every query', () => {
    const configs = buildNetflowQueryConfigs({
      source,
      dateRange,
      filters: { protocol: '17' },
    });
    for (const config of Object.values(configs)) {
      expect(config).toMatchObject({
        source: 'flows',
        connection: 'local',
        dateRange,
        from: source.from,
        whereLanguage: 'lucene',
        where: '',
        filters: [{ type: 'sql', condition: "(toString(Proto) = '17')" }],
      });
    }
    expect(configs.flows.limit).toEqual({ limit: 500 });
    expect(configs.topSourceAddresses.limit).toEqual({ limit: 10 });
  });

  it.each(['lucene', 'sql'] as const)(
    'combines %s search with quick filters on every chart',
    whereLanguage => {
      const where =
        whereLanguage === 'lucene'
          ? 'DstPort:443 OR DstPort:80'
          : 'DstPort = 443 OR DstPort = 80';
      const configs = buildNetflowQueryConfigs({
        source,
        dateRange,
        filters: { protocol: '6' },
        where,
        whereLanguage,
        extraFilters: [{ type: 'sql', condition: "ExporterName = 'edge-a'" }],
      });
      for (const config of Object.values(configs)) {
        expect(config).toMatchObject({
          where,
          whereLanguage,
          filters: [
            { type: 'sql', condition: "ExporterName = 'edge-a'" },
            { type: 'sql', condition: "(toString(Proto) = '6')" },
          ],
        });
      }
    },
  );

  it('rejects empty or reversed time ranges', () => {
    expect(() =>
      buildNetflowQueryConfigs({
        source,
        dateRange: [dateRange[1], dateRange[0]],
        filters: {},
      }),
    ).toThrow('Time range');
  });
});

describe.each([undefined, 'SearchText'])(
  'NetFlow full-text hydration with override %s',
  implicitColumnExpression => {
    const selectedSource = { ...source, implicitColumnExpression };
    const select = [{ valueExpression: 'sum(Bytes)' }];
    const expected =
      implicitColumnExpression ?? expect.stringContaining('toString(SrcAddr)');

    it.each(['sql', 'builder'] as const)(
      'carries the search mapping into %s chart editor previews',
      configType => {
        const config = convertFormStateToChartConfig(
          {
            configType,
            displayType: DisplayType.Line,
            source: source.id,
            connection: source.connection,
            where: 'edge',
            whereLanguage: 'lucene',
            series: select,
            sqlTemplate: 'SELECT sum(Bytes) FROM flows WHERE $where',
          },
          dateRange,
          selectedSource,
        );
        expect(config).toMatchObject({ implicitColumnExpression: expected });
      },
    );

    it.each(['sql', 'builder'] as const)(
      'carries the search mapping into %s saved alert charts',
      configType => {
        const savedConfig =
          configType === 'sql'
            ? {
                configType: 'sql' as const,
                displayType: DisplayType.Line,
                source: source.id,
                connection: source.connection,
                sqlTemplate: 'SELECT sum(Bytes) FROM flows WHERE $where',
              }
            : {
                displayType: DisplayType.Line,
                source: source.id,
                select,
                where: 'edge',
                whereLanguage: 'lucene' as const,
              };
        const config = buildAlertChartConfig({
          savedConfig,
          source: selectedSource,
          dateRange,
          granularity: Granularity.OneMinute,
          variables: [],
        });
        expect(config).toMatchObject({ implicitColumnExpression: expected });
      },
    );

    it('carries the search mapping into release queries scoped by bare Lucene terms', () => {
      const config = buildReleaseChartConfig(
        selectedSource,
        'Version',
        dateRange,
        { where: 'edge', whereLanguage: 'lucene' },
      );
      expect(config).toMatchObject({
        implicitColumnExpression: expected,
        filters: [{ type: 'lucene', condition: 'edge' }],
      });
    });
  },
);
