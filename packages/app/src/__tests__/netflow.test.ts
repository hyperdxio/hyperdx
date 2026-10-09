import { SourceKind, TNetflowSource } from '@hyperdx/common-utils/dist/types';

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
  it('estimates sampled traffic but counts stored flow records', () => {
    const configs = buildNetflowQueryConfigs({
      source,
      dateRange,
      filters: {},
    });
    expect(configs.totalBytes.select).toEqual([
      {
        valueExpression: 'sum(toFloat64(Bytes) * (SamplingRate))',
        alias: '__netflow_value',
      },
    ]);
    expect(configs.bitsPerSecond.select).toEqual([
      {
        valueExpression: 'sum(toFloat64(Bytes) * (SamplingRate)) * 8 / 3600',
        alias: '__netflow_value',
      },
    ]);
    expect(configs.flowRecords.select).toEqual([
      { valueExpression: 'count()', alias: '__netflow_value' },
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
      });
      for (const config of Object.values(configs)) {
        expect(config).toMatchObject({
          where,
          whereLanguage,
          filters: [{ type: 'sql', condition: "(toString(Proto) = '6')" }],
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
