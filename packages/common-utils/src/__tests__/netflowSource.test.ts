import {
  buildSearchChartConfig,
  getSourceImplicitColumnExpression,
  netflowProtocolNameExpression,
} from '@/core/searchChartConfig';
import {
  isSearchableSource,
  SourceKind,
  SourceSchema,
  SourceSchemaNoId,
} from '@/types';

const source = {
  id: 'netflow',
  kind: SourceKind.Netflow,
  name: 'Network flows',
  connection: 'clickhouse',
  from: { databaseName: 'default', tableName: 'flows' },
  timestampValueExpression: 'TimeReceived',
  defaultTableSelectExpression: 'TimeReceived, SrcAddr, DstAddr, Bytes',
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

it('preserves NetFlow mappings through create and update validation', () => {
  expect(SourceSchema.parse(source)).toEqual(source);
  const { id: _id, ...input } = source;
  expect(SourceSchemaNoId.parse(input)).toEqual(input);
});

it('supports unsampled data without exporter or interface metadata', () => {
  expect(
    SourceSchema.safeParse({
      ...source,
      samplingRateExpression: undefined,
      exporterExpression: undefined,
      inIfExpression: undefined,
      outIfExpression: undefined,
    }).success,
  ).toBe(true);
});

it.each([
  'bytesExpression',
  'packetsExpression',
  'srcAddrExpression',
  'dstAddrExpression',
  'protocolExpression',
])('requires the %s mapping', field => {
  expect(SourceSchema.safeParse({ ...source, [field]: '' }).success).toBe(
    false,
  );
});

it('searches raw flows with mapped defaults without log-only fields or sampling weights', () => {
  const parsed = SourceSchema.parse(source);
  expect(isSearchableSource(parsed)).toBe(true);
  const config = buildSearchChartConfig(parsed, {
    where: 'Proto = 6',
    whereLanguage: 'sql',
  });
  expect(config.select).toBe(source.defaultTableSelectExpression);
  expect(config.timestampValueExpression).toBe('TimeReceived');
  expect(config.where).toBe('Proto = 6');
  expect(config).not.toHaveProperty('bodyExpression');
  expect(config).not.toHaveProperty('sampleWeightExpression');
});

it('searches mapped NetFlow dimensions for bare Lucene terms by default', () => {
  const config = buildSearchChartConfig(SourceSchema.parse(source), {
    where: 'edge-router',
    whereLanguage: 'lucene',
  });
  expect(config.implicitColumnExpression).toContain('toString(SrcAddr)');
  expect(config.implicitColumnExpression).toContain('toString(ExporterName)');
  expect(config.implicitColumnExpression).toContain('toString(OutIfName)');
  expect(config.implicitColumnExpression).toContain(
    "ifNull(toString(Proto), '')",
  );
  expect(config.implicitColumnExpression).toContain(
    netflowProtocolNameExpression('Proto'),
  );
  expect(netflowProtocolNameExpression('Proto')).toBe(
    "transform(toString(Proto), ['1', '6', '17', '47', '50', '58'], ['ICMP', 'TCP', 'UDP', 'GRE', 'ESP', 'ICMPv6'], toString(Proto))",
  );
  expect(getSourceImplicitColumnExpression(SourceSchema.parse(source))).toBe(
    config.implicitColumnExpression,
  );
});

it('preserves and uses a custom NetFlow implicit expression', () => {
  const parsed = SourceSchema.parse({
    ...source,
    implicitColumnExpression: 'SearchText',
  });
  expect(parsed).toHaveProperty('implicitColumnExpression', 'SearchText');
  expect(getSourceImplicitColumnExpression(parsed)).toBe('SearchText');
  expect(
    buildSearchChartConfig(parsed, { where: 'router' })
      .implicitColumnExpression,
  ).toBe('SearchText');
});

it('derives implicit search from custom mappings and ignores blank optional dimensions', () => {
  const parsed = SourceSchema.parse({
    ...source,
    srcAddrExpression: 'client_ip',
    implicitColumnExpression: '  ',
    exporterExpression: '  ',
    inIfExpression: undefined,
    outIfExpression: '',
  });
  const implicit = buildSearchChartConfig(parsed, {
    where: 'router',
  }).implicitColumnExpression;
  expect(implicit).toContain('toString(client_ip)');
  expect(implicit).not.toMatch(
    /SrcAddr|ExporterName|InIfName|OutIfName|toString\(\s*\)/,
  );
});
