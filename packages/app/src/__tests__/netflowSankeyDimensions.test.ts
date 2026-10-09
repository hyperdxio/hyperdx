import { ColumnMeta } from '@hyperdx/common-utils/dist/clickhouse';
import { SourceKind, TNetflowSource } from '@hyperdx/common-utils/dist/types';

import {
  getDefaultSankeyDimensions,
  getSankeyDimensionOptions,
} from '@/netflowSankeyDimensions';

const source: TNetflowSource = {
  id: 'flows',
  name: 'Flows',
  kind: SourceKind.Netflow,
  connection: 'local',
  from: { databaseName: 'default', tableName: 'flows' },
  timestampValueExpression: 'TimeReceived',
  defaultTableSelectExpression: '*',
  bytesExpression: 'Bytes',
  packetsExpression: 'Packets',
  srcAddrExpression: 'SrcAddr',
  dstAddrExpression: 'DstAddr',
  srcPortExpression: 'SrcPort',
  dstPortExpression: 'DstPort',
  protocolExpression: 'Proto',
  exporterExpression: 'ExporterName',
};

const column = (name: string, type = 'String'): ColumnMeta => ({
  name,
  type,
  codec_expression: '',
  comment: '',
  default_expression: '',
  default_type: '',
  ttl_expression: '',
});

describe('NetFlow Sankey dimension options', () => {
  it.each([
    'String',
    'LowCardinality(Nullable(String))',
    'UInt32',
    'Float64',
    'Bool',
    'DateTime64(3)',
    'IPv6',
  ])('offers scalar %s columns and quotes unusual identifiers', type => {
    expect(
      getSankeyDimensionOptions(source, [column('custom field', type)]),
    ).toContainEqual({
      key: 'column:custom field',
      label: 'custom field',
      expression: '`custom field`',
    });
  });

  it.each([
    'Array(String)',
    'Map(String, String)',
    'Tuple(String, UInt32)',
    'JSON',
    'Dynamic',
    'Unknown',
  ])('excludes %s columns from scalar dimensions', type => {
    expect(
      getSankeyDimensionOptions(source, [column('nested', type)]),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'column:nested' }),
      ]),
    );
  });

  it('omits blank optional mappings and retains trimmed mapped expressions', () => {
    const options = getSankeyDimensionOptions(
      {
        ...source,
        exporterExpression: '   ',
        inIfExpression: '',
        outIfExpression: ' OutIfName ',
      },
      [],
    );
    expect(options.map(option => option.key)).toEqual([
      'srcAddr',
      'dstAddr',
      'protocol',
      'outputInterface',
    ]);
    expect(options).toContainEqual({
      key: 'outputInterface',
      label: 'Output interface',
      expression: 'OutIfName',
    });
  });
});

describe('NetFlow Sankey default dimensions', () => {
  const enrichment = [
    column('SrcAS', 'UInt32'),
    column('InIfConnectivity'),
    column('InIfProvider'),
  ];

  it('uses the Akvorado path when every enriched dimension is available', () => {
    expect(
      getDefaultSankeyDimensions(getSankeyDimensionOptions(source, enrichment)),
    ).toEqual([
      'column:SrcAS',
      'column:InIfConnectivity',
      'column:InIfProvider',
      'exporter',
    ]);
  });

  it.each([
    [source, []],
    [source, enrichment.slice(0, 2)],
    [{ ...source, exporterExpression: '' }, enrichment],
  ] as const)(
    'falls back when an Akvorado dimension is unavailable',
    (selectedSource, columns) => {
      expect(
        getDefaultSankeyDimensions(
          getSankeyDimensionOptions(selectedSource, [...columns]),
        ),
      ).toEqual(['srcAddr', 'protocol', 'dstAddr']);
    },
  );
});
