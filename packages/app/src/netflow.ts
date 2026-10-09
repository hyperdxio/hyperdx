import { FIXED_TIME_BUCKET_EXPR_ALIAS } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { getSourceImplicitColumnExpression } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import {
  convertDateRangeToGranularityString,
  convertGranularityToSeconds,
  escapeSqlString,
  getFirstTimestampValueExpression,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  BuilderChartConfigWithDateRange,
  DisplayType,
  Filter,
  NumberFormat,
  NumericUnit,
  SearchConditionLanguage,
  TNetflowSource,
} from '@hyperdx/common-utils/dist/types';

export const NETFLOW_DIMENSION_LABELS: Record<string, string> = {
  srcAddr: 'Source IP',
  dstAddr: 'Destination IP',
  protocol: 'Protocol',
  exporter: 'Exporter',
  inputInterface: 'Input interface',
  outputInterface: 'Output interface',
} satisfies Record<NetflowFilterField, string>;
export type NetflowFilterField = keyof ReturnType<typeof getNetflowDimensions>;
export const netflowColumnAlias = (field: string) => `__netflow_${field}`;
export const NETFLOW_ALIASES = {
  name: netflowColumnAlias('name'),
  bytes: netflowColumnAlias('bytes'),
  value: netflowColumnAlias('value'),
};
const PROTOCOL_NAMES = {
  1: 'ICMP',
  6: 'TCP',
  17: 'UDP',
  47: 'GRE',
  50: 'ESP',
  58: 'ICMPv6',
};
export const NETFLOW_SUMMARY_TILES = [
  {
    title: 'Average bit rate',
    column: netflowColumnAlias('bitsPerSecond'),
    numberFormat: {
      output: 'data_rate',
      numericUnit: NumericUnit.BitsSecSI,
      mantissa: 2,
    },
  },
  {
    title: 'Average packet rate',
    column: netflowColumnAlias('packetsPerSecond'),
    numberFormat: {
      output: 'throughput',
      numericUnit: NumericUnit.PacketsSec,
      mantissa: 2,
    },
  },
  {
    title: 'Transferred bytes',
    column: NETFLOW_ALIASES.bytes,
    numberFormat: { output: 'byte', mantissa: 2 },
  },
  {
    title: 'Flow records',
    column: netflowColumnAlias('flowRecords'),
    numberFormat: { output: 'number', thousandSeparated: true },
  },
] satisfies { title: string; column: string; numberFormat: NumberFormat }[];

export type NetflowFilters = {
  exporter?: string;
  protocol?: string;
  srcAddr?: string;
  dstAddr?: string;
};

export function getNetflowDimensions(source: TNetflowSource) {
  const address = (expression: string) =>
    `replaceRegexpOne(toString(${expression}), '^::ffff:', '')`;
  return {
    srcAddr: address(source.srcAddrExpression),
    dstAddr: address(source.dstAddrExpression),
    protocol: `transform(toString(${source.protocolExpression}), [${Object.keys(
      PROTOCOL_NAMES,
    )
      .map(value => `'${value}'`)
      .join(', ')}], [${Object.values(PROTOCOL_NAMES)
      .map(value => `'${value}'`)
      .join(', ')}], toString(${source.protocolExpression}))`,
    exporter: source.exporterExpression?.trim(),
    inputInterface: source.inIfExpression?.trim(),
    outputInterface: source.outIfExpression?.trim(),
  };
}

export function buildNetflowWhere(
  source: TNetflowSource,
  filters: NetflowFilters,
) {
  const predicates: string[] = [];
  for (const [value, expression, address] of [
    [filters.exporter, source.exporterExpression, false],
    [filters.protocol, source.protocolExpression, false],
    [filters.srcAddr, source.srcAddrExpression, true],
    [filters.dstAddr, source.dstAddrExpression, true],
  ] as const) {
    if (!value?.trim() || !expression?.trim()) continue;
    const literal = `'${escapeSqlString(value.trim())}'`;
    predicates.push(
      address
        ? `toIPv6OrNull(toString(${expression})) = toIPv6OrNull(${literal})`
        : `toString(${expression}) = ${literal}`,
    );
  }
  return predicates.map(predicate => `(${predicate})`).join(' AND ');
}

export function buildNetflowQueryConfigs({
  source,
  dateRange,
  filters,
  where = '',
  whereLanguage = 'lucene',
  extraFilters = [],
}: {
  source: TNetflowSource;
  dateRange: [Date, Date];
  filters: NetflowFilters;
  where?: string;
  whereLanguage?: SearchConditionLanguage;
  extraFilters?: Filter[];
}) {
  const seconds = (dateRange[1].getTime() - dateRange[0].getTime()) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new Error('Time range must have a start before its end');

  const samplingRate = source.samplingRateExpression?.trim();
  const sample = samplingRate
    ? `if((${samplingRate}) > 0, (${samplingRate}), 1)`
    : '1';
  const exporter = source.exporterExpression?.trim();
  const inputInterface = source.inIfExpression?.trim();
  const outputInterface = source.outIfExpression?.trim();
  // Akvorado stores raw counters: scale once, before summing. Float64 avoids UInt64 multiplication overflow.
  const bytes = `toFloat64(${source.bytesExpression}) * (${sample})`;
  const packets = `toFloat64(${source.packetsExpression}) * (${sample})`;
  const granularity = convertDateRangeToGranularityString(dateRange);
  const bucketSeconds = convertGranularityToSeconds(granularity);
  const timestamp = getFirstTimestampValueExpression(
    source.timestampValueExpression,
  );
  const bucketStart = `toUnixTimestamp64Milli(toDateTime64(\`${FIXED_TIME_BUCKET_EXPR_ALIAS}\`, 3)) / 1000`;
  // Edge buckets cover only the intersection with the selected range.
  const coveredSeconds = `least(${bucketStart} + ${bucketSeconds}, ${dateRange[1].getTime() / 1000}) - greatest(${bucketStart}, ${dateRange[0].getTime() / 1000})`;
  const dimensions = getNetflowDimensions(source);
  const protocol = dimensions.protocol;
  const base = {
    from: source.from,
    connection: source.connection,
    source: source.id,
    timestampValueExpression: source.timestampValueExpression,
    implicitColumnExpression: getSourceImplicitColumnExpression(source),
    dateRange,
    dateRangeEndInclusive: false,
    alignDateRangeToGranularity: false,
    where,
    whereLanguage,
    filters: [
      ...extraFilters,
      { type: 'sql' as const, condition: buildNetflowWhere(source, filters) },
    ],
  };
  // Keep result aliases separate from common mapped column names: ClickHouse substitutes aliases in WHERE and sibling expressions.
  const byteFormat: NumberFormat = { output: 'byte', mantissa: 2 };
  const bitRateFormat: NumberFormat = {
    output: 'data_rate',
    numericUnit: NumericUnit.BitsSecSI,
    mantissa: 2,
  };
  const top = (expression: string): BuilderChartConfigWithDateRange => ({
    ...base,
    select: [
      { valueExpression: expression, alias: netflowColumnAlias('name') },
      { valueExpression: `sum(${bytes})`, alias: netflowColumnAlias('bytes') },
    ],
    groupBy: NETFLOW_ALIASES.name,
    orderBy: `${NETFLOW_ALIASES.bytes} DESC`,
    limit: { limit: 10 },
    displayType: DisplayType.Bar,
    numberFormat: byteFormat,
  });
  const traffic: BuilderChartConfigWithDateRange = {
    ...base,
    select: [
      {
        valueExpression: `sum(${bytes}) * 8 / (${coveredSeconds})`,
        alias: 'Bits per second',
      },
    ],
    granularity,
    displayType: DisplayType.Line,
    numberFormat: bitRateFormat,
  };
  const flows: BuilderChartConfigWithDateRange = {
    ...base,
    select: [
      {
        valueExpression: timestamp,
        alias: netflowColumnAlias('timestamp'),
      },
      {
        valueExpression: dimensions.srcAddr,
        alias: netflowColumnAlias('srcAddr'),
      },
      {
        valueExpression: dimensions.dstAddr,
        alias: netflowColumnAlias('dstAddr'),
      },
      {
        valueExpression: source.srcPortExpression,
        alias: netflowColumnAlias('srcPort'),
      },
      {
        valueExpression: source.dstPortExpression,
        alias: netflowColumnAlias('dstPort'),
      },
      { valueExpression: protocol, alias: netflowColumnAlias('protocol') },
      {
        valueExpression: exporter || "''",
        alias: netflowColumnAlias('exporter'),
      },
      { valueExpression: bytes, alias: netflowColumnAlias('bytes') },
      { valueExpression: packets, alias: netflowColumnAlias('packets') },
      {
        valueExpression: source.bytesExpression,
        alias: netflowColumnAlias('rawBytes'),
      },
      {
        valueExpression: source.packetsExpression,
        alias: netflowColumnAlias('rawPackets'),
      },
      { valueExpression: sample, alias: netflowColumnAlias('samplingRate') },
      {
        valueExpression: inputInterface || "''",
        alias: netflowColumnAlias('inputInterface'),
      },
      {
        valueExpression: outputInterface || "''",
        alias: netflowColumnAlias('outputInterface'),
      },
    ],
    orderBy: `${timestamp} DESC`,
    limit: { limit: 500 },
    displayType: DisplayType.Table,
  };

  return {
    summary: {
      ...base,
      select: [
        {
          valueExpression: `sum(${bytes}) * 8 / ${seconds}`,
          alias: netflowColumnAlias('bitsPerSecond'),
        },
        {
          valueExpression: `sum(${packets}) / ${seconds}`,
          alias: netflowColumnAlias('packetsPerSecond'),
        },
        { valueExpression: `sum(${bytes})`, alias: NETFLOW_ALIASES.bytes },
        {
          valueExpression: 'count()',
          alias: netflowColumnAlias('flowRecords'),
        },
      ],
      displayType: DisplayType.Number,
    } satisfies BuilderChartConfigWithDateRange,
    totalBytes: {
      ...base,
      select: [
        { valueExpression: `sum(${bytes})`, alias: NETFLOW_ALIASES.value },
      ],
      displayType: DisplayType.Number,
      numberFormat: byteFormat,
    } satisfies BuilderChartConfigWithDateRange,
    traffic,
    topSourceAddresses: top(dimensions.srcAddr),
    topDestinationAddresses: top(dimensions.dstAddr),
    protocols: top(protocol),
    exporters: exporter ? top(exporter) : undefined,
    inInterfaces: inputInterface ? top(inputInterface) : undefined,
    outInterfaces: outputInterface ? top(outputInterface) : undefined,
    flows,
  };
}
