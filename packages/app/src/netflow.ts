import {
  convertDateRangeToGranularityString,
  convertGranularityToSeconds,
  escapeSqlString,
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
    protocol: `transform(toString(${source.protocolExpression}), ['1', '6', '17', '47', '50', '58'], ['ICMP', 'TCP', 'UDP', 'GRE', 'ESP', 'ICMPv6'], toString(${source.protocolExpression}))`,
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

  const sample = source.samplingRateExpression?.trim() || '1';
  const exporter = source.exporterExpression?.trim();
  const inputInterface = source.inIfExpression?.trim();
  const outputInterface = source.outIfExpression?.trim();
  // Akvorado stores raw counters: scale once, before summing. Float64 avoids UInt64 multiplication overflow.
  const bytes = `toFloat64(${source.bytesExpression}) * (${sample})`;
  const packets = `toFloat64(${source.packetsExpression}) * (${sample})`;
  const granularity = convertDateRangeToGranularityString(dateRange);
  const bucketSeconds = convertGranularityToSeconds(granularity);
  const dimensions = getNetflowDimensions(source);
  const protocol = dimensions.protocol;
  const base = {
    from: source.from,
    connection: source.connection,
    source: source.id,
    timestampValueExpression: source.timestampValueExpression,
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
  const number = (
    valueExpression: string,
    numberFormat: NumberFormat,
  ): BuilderChartConfigWithDateRange => ({
    ...base,
    select: [{ valueExpression, alias: '__netflow_value' }],
    displayType: DisplayType.Number,
    numberFormat,
  });
  const byteFormat: NumberFormat = { output: 'byte', mantissa: 2 };
  const bitRateFormat: NumberFormat = {
    output: 'data_rate',
    numericUnit: NumericUnit.BitsSecSI,
    mantissa: 2,
  };
  const top = (expression: string): BuilderChartConfigWithDateRange => ({
    ...base,
    select: [
      { valueExpression: expression, alias: '__netflow_name' },
      { valueExpression: `sum(${bytes})`, alias: '__netflow_bytes' },
    ],
    groupBy: '__netflow_name',
    orderBy: '__netflow_bytes DESC',
    limit: { limit: 10 },
    displayType: DisplayType.Bar,
    numberFormat: byteFormat,
  });
  const traffic: BuilderChartConfigWithDateRange = {
    ...base,
    select: [
      {
        valueExpression: `sum(${bytes}) * 8 / ${bucketSeconds}`,
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
        valueExpression: source.timestampValueExpression,
        alias: '__netflow_timestamp',
      },
      {
        valueExpression: dimensions.srcAddr,
        alias: '__netflow_srcAddr',
      },
      {
        valueExpression: dimensions.dstAddr,
        alias: '__netflow_dstAddr',
      },
      { valueExpression: source.srcPortExpression, alias: '__netflow_srcPort' },
      { valueExpression: source.dstPortExpression, alias: '__netflow_dstPort' },
      { valueExpression: protocol, alias: '__netflow_protocol' },
      { valueExpression: exporter || "''", alias: '__netflow_exporter' },
      { valueExpression: bytes, alias: '__netflow_bytes' },
      { valueExpression: packets, alias: '__netflow_packets' },
      { valueExpression: source.bytesExpression, alias: '__netflow_rawBytes' },
      {
        valueExpression: source.packetsExpression,
        alias: '__netflow_rawPackets',
      },
      { valueExpression: sample, alias: '__netflow_samplingRate' },
      {
        valueExpression: inputInterface || "''",
        alias: '__netflow_inputInterface',
      },
      {
        valueExpression: outputInterface || "''",
        alias: '__netflow_outputInterface',
      },
    ],
    orderBy: `${source.timestampValueExpression} DESC`,
    limit: { limit: 500 },
    displayType: DisplayType.Table,
  };

  return {
    bitsPerSecond: number(`sum(${bytes}) * 8 / ${seconds}`, bitRateFormat),
    packetsPerSecond: number(`sum(${packets}) / ${seconds}`, {
      output: 'throughput',
      numericUnit: NumericUnit.PacketsSec,
      mantissa: 2,
    }),
    totalBytes: number(`sum(${bytes})`, byteFormat),
    flowRecords: number('count()', {
      output: 'number',
      thousandSeparated: true,
    }),
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
