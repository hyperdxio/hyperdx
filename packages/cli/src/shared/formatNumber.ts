/**
 * Number formatting for chart values.
 *
 * @source packages/app/src/utils.ts (formatNumber, formatDurationMs,
 *   NUMERIC_UNIT_CONFIGS, formatAutoScaleData) and
 *   packages/app/src/source.ts (getTraceDurationNumberFormat,
 *   getFirstSeriesNumberFormat, useSingleSeriesNumberFormat,
 *   useChartNumberFormats — de-hooked here).
 *
 * Same behavior as the web frontend so tile values render identically.
 */

import numbro from 'numbro';

import { isRatioChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { isBuilderChartConfig } from '@hyperdx/common-utils/dist/guards';
import type { ColumnMetaType } from '@hyperdx/common-utils/dist/clickhouse';
import type {
  ChartConfigWithOptDateRange,
  NumberFormat,
} from '@hyperdx/common-utils/dist/types';
import { NumericUnit } from '@hyperdx/common-utils/dist/types';

import type { SourceResponse } from '@/api/client';

type AutoScaleUnitConfig = {
  type: 'auto_scale';
  base: 'iec' | 'si';
  isBits: boolean;
  perSec: boolean;
};

type FixedUnitConfig = {
  type: 'fixed';
  suffix: string;
};

type UnitFormatConfig = AutoScaleUnitConfig | FixedUnitConfig;

const NUMERIC_UNIT_CONFIGS: Record<NumericUnit, UnitFormatConfig> = {
  // Data
  [NumericUnit.BytesIEC]: {
    type: 'auto_scale',
    base: 'iec',
    isBits: false,
    perSec: false,
  },
  [NumericUnit.BytesSI]: {
    type: 'auto_scale',
    base: 'si',
    isBits: false,
    perSec: false,
  },
  [NumericUnit.BitsIEC]: {
    type: 'auto_scale',
    base: 'iec',
    isBits: true,
    perSec: false,
  },
  [NumericUnit.BitsSI]: {
    type: 'auto_scale',
    base: 'si',
    isBits: true,
    perSec: false,
  },
  [NumericUnit.Kibibytes]: { type: 'fixed', suffix: 'KiB' },
  [NumericUnit.Kilobytes]: { type: 'fixed', suffix: 'KB' },
  [NumericUnit.Mebibytes]: { type: 'fixed', suffix: 'MiB' },
  [NumericUnit.Megabytes]: { type: 'fixed', suffix: 'MB' },
  [NumericUnit.Gibibytes]: { type: 'fixed', suffix: 'GiB' },
  [NumericUnit.Gigabytes]: { type: 'fixed', suffix: 'GB' },
  [NumericUnit.Tebibytes]: { type: 'fixed', suffix: 'TiB' },
  [NumericUnit.Terabytes]: { type: 'fixed', suffix: 'TB' },
  [NumericUnit.Pebibytes]: { type: 'fixed', suffix: 'PiB' },
  [NumericUnit.Petabytes]: { type: 'fixed', suffix: 'PB' },
  // Data Rate
  [NumericUnit.PacketsSec]: { type: 'fixed', suffix: 'pkt/s' },
  [NumericUnit.BytesSecIEC]: {
    type: 'auto_scale',
    base: 'iec',
    isBits: false,
    perSec: true,
  },
  [NumericUnit.BytesSecSI]: {
    type: 'auto_scale',
    base: 'si',
    isBits: false,
    perSec: true,
  },
  [NumericUnit.BitsSecIEC]: {
    type: 'auto_scale',
    base: 'iec',
    isBits: true,
    perSec: true,
  },
  [NumericUnit.BitsSecSI]: {
    type: 'auto_scale',
    base: 'si',
    isBits: true,
    perSec: true,
  },
  [NumericUnit.KibibytesSec]: { type: 'fixed', suffix: 'KiB/s' },
  [NumericUnit.KibibitsSec]: { type: 'fixed', suffix: 'Kibit/s' },
  [NumericUnit.KilobytesSec]: { type: 'fixed', suffix: 'KB/s' },
  [NumericUnit.KilobitsSec]: { type: 'fixed', suffix: 'Kbit/s' },
  [NumericUnit.MebibytesSec]: { type: 'fixed', suffix: 'MiB/s' },
  [NumericUnit.MebibitsSec]: { type: 'fixed', suffix: 'Mibit/s' },
  [NumericUnit.MegabytesSec]: { type: 'fixed', suffix: 'MB/s' },
  [NumericUnit.MegabitsSec]: { type: 'fixed', suffix: 'Mbit/s' },
  [NumericUnit.GibibytesSec]: { type: 'fixed', suffix: 'GiB/s' },
  [NumericUnit.GibibitsSec]: { type: 'fixed', suffix: 'Gibit/s' },
  [NumericUnit.GigabytesSec]: { type: 'fixed', suffix: 'GB/s' },
  [NumericUnit.GigabitsSec]: { type: 'fixed', suffix: 'Gbit/s' },
  [NumericUnit.TebibytesSec]: { type: 'fixed', suffix: 'TiB/s' },
  [NumericUnit.TebibitsSec]: { type: 'fixed', suffix: 'Tibit/s' },
  [NumericUnit.TerabytesSec]: { type: 'fixed', suffix: 'TB/s' },
  [NumericUnit.TerabitsSec]: { type: 'fixed', suffix: 'Tbit/s' },
  [NumericUnit.PebibytesSec]: { type: 'fixed', suffix: 'PiB/s' },
  [NumericUnit.PebibitsSec]: { type: 'fixed', suffix: 'Pibit/s' },
  [NumericUnit.PetabytesSec]: { type: 'fixed', suffix: 'PB/s' },
  [NumericUnit.PetabitsSec]: { type: 'fixed', suffix: 'Pbit/s' },
  // Throughput
  [NumericUnit.Cps]: { type: 'fixed', suffix: 'cps' },
  [NumericUnit.Ops]: { type: 'fixed', suffix: 'ops' },
  [NumericUnit.Rps]: { type: 'fixed', suffix: 'rps' },
  [NumericUnit.ReadsSec]: { type: 'fixed', suffix: 'rps' },
  [NumericUnit.Wps]: { type: 'fixed', suffix: 'wps' },
  [NumericUnit.Iops]: { type: 'fixed', suffix: 'iops' },
  [NumericUnit.Cpm]: { type: 'fixed', suffix: 'cpm' },
  [NumericUnit.Opm]: { type: 'fixed', suffix: 'opm' },
  [NumericUnit.RpmReads]: { type: 'fixed', suffix: 'rpm' },
  [NumericUnit.Wpm]: { type: 'fixed', suffix: 'wpm' },
};

const IEC_BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
const SI_BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
const IEC_BIT_UNITS = ['b', 'Kibit', 'Mibit', 'Gibit', 'Tibit', 'Pibit'];
const SI_BIT_UNITS = ['b', 'Kbit', 'Mbit', 'Gbit', 'Tbit', 'Pbit'];

const formatAutoScaleData = (
  value: number,
  base: 'iec' | 'si',
  isBits: boolean,
  perSec: boolean,
  mantissa: number,
): string => {
  const divisor = base === 'iec' ? 1024 : 1000;
  const units =
    base === 'iec'
      ? isBits
        ? IEC_BIT_UNITS
        : IEC_BYTE_UNITS
      : isBits
        ? SI_BIT_UNITS
        : SI_BYTE_UNITS;
  const rateSuffix = perSec ? '/s' : '';

  let absVal = Math.abs(value);
  let i = 0;
  while (absVal >= divisor && i < units.length - 1) {
    absVal /= divisor;
    i++;
  }
  const scaledValue = value < 0 ? -absVal : absVal;
  return `${scaledValue.toFixed(mantissa)} ${units[i]}${rateSuffix}`;
};

export const formatNumber = (
  value?: string | number,
  options?: NumberFormat,
): string => {
  if (!value && value !== 0) {
    return 'N/A';
  }

  // Guard against NaN only - ClickHouse can return numbers as strings, which
  // we should still format. Only truly non-numeric values (NaN) get passed through.
  if (typeof value !== 'number') {
    if (isNaN(Number(value))) {
      return String(value);
    }
    value = Number(value);
  }

  if (!options) {
    return value.toString();
  }

  const mantissa = options.mantissa ?? 0;

  // Handle new unit categories with numericUnit
  if (
    options.numericUnit &&
    (options.output === 'byte' ||
      options.output === 'data_rate' ||
      options.output === 'throughput')
  ) {
    const config = NUMERIC_UNIT_CONFIGS[options.numericUnit];
    if (config) {
      if (config.type === 'auto_scale') {
        return formatAutoScaleData(
          value,
          config.base,
          config.isBits,
          config.perSec,
          mantissa,
        );
      }
      return `${value.toFixed(mantissa)} ${config.suffix}`;
    }
  }

  // Handle data_rate / throughput without a numericUnit — fall through to number
  if (options.output === 'data_rate' || options.output === 'throughput') {
    return value.toFixed(mantissa);
  }

  if (options.output === 'duration') {
    const factor = options.factor ?? 1;
    const ms = value * factor * 1000;
    return formatDurationMs(ms);
  }

  const numbroFormat: numbro.Format = {
    output: options.output || 'number',
    mantissa: mantissa,
    thousandSeparated: options.thousandSeparated || false,
    average: options.average || false,
    ...(options.output === 'byte' && {
      base: options.decimalBytes ? 'decimal' : 'general',
      spaceSeparated: true,
      average: false,
    }),
    ...(options.output === 'currency' && {
      currencySymbol: options.currencySymbol || '$',
    }),
  };

  // Factor is only currently available for the time output
  const factor = options.output === 'time' ? (options.factor ?? 1) : 1;

  return (
    numbro(value * factor).format(numbroFormat) +
    (options.unit ? ` ${options.unit}` : '')
  );
};

/**
/**
 * Formats a duration value given in milliseconds into a human-readable
 * adaptive string (e.g. "120.41s", "45ms", "3µs"). Mirrors the trace
 * waterfall rendering style.
 */
function formatDurationMs(ms: number): string {
  if (ms < 0) {
    return `-${formatDurationMs(-ms)}`;
  }

  if (ms === 0) {
    return '0ms';
  }

  if (ms < 1) {
    const µs = ms * 1000;
    if (µs < 10) {
      return `${parseFloat(µs.toPrecision(2))}µs`;
    }
    const µsRounded = Math.round(µs);
    if (µsRounded < 1000) {
      return `${µsRounded}µs`;
    }
  }

  if (ms < 1000) {
    if (ms < 10) {
      return `${parseFloat(ms.toPrecision(3))}ms`;
    }
    return `${parseFloat(ms.toFixed(1))}ms`;
  }

  if (ms < 60_000) {
    return `${parseFloat((ms / 1000).toFixed(2))}s`;
  }

  if (ms < 3_600_000) {
    return `${parseFloat((ms / 60_000).toFixed(2))}min`;
  }

  return `${parseFloat((ms / 3_600_000).toFixed(2))}h`;
}

// ---- Number-format resolution (de-hooked from packages/app/src/source.ts) --

// Aggregate functions whose output preserves the unit of the input value.
// count and count_distinct produce dimensionless counts and should not
// inherit the duration format.
const DURATION_PRESERVING_AGG_FNS = new Set([
  'avg',
  'min',
  'max',
  'sum',
  'any',
  'last_value',
  'quantile',
  'quantileMerge',
  'p50',
  'p90',
  'p95',
  'p99',
  'heatmap',
  'histogram',
  'histogramMerge',
]);

function isDurationPreservingAggFn(aggFn: string | undefined): boolean {
  if (!aggFn) return true; // no aggFn means raw expression — preserve unit
  // Handle combinator forms like "avgIf", "quantileIfState"
  const baseFn = aggFn.replace(/If(State|Merge)?$/, '');
  return DURATION_PRESERVING_AGG_FNS.has(baseFn);
}

/**
 * Returns a NumberFormat for duration display if the given select expression
 * exactly matches a trace source's durationExpression.
 *
 * @source packages/app/src/source.ts (getTraceDurationNumberFormat)
 */
function getTraceDurationNumberFormat(
  source: SourceResponse | undefined,
  selectExpression: { valueExpression?: string; aggFn?: string },
): NumberFormat | undefined {
  if (!source || source.kind !== 'trace' || !source.durationExpression)
    return undefined;

  const durationExpr = source.durationExpression;
  const precision = source.durationPrecision ?? 9;

  if (!selectExpression.valueExpression) return undefined;
  if (!isDurationPreservingAggFn(selectExpression.aggFn)) return undefined;

  if (selectExpression.valueExpression === durationExpr) {
    return {
      output: 'duration',
      factor: Math.pow(10, -precision),
    };
  }

  return undefined;
}

type SelectItem = {
  numberFormat?: NumberFormat;
  valueExpression?: string;
  aggFn?: string;
};

/**
 * @source packages/app/src/source.ts (getFirstSeriesNumberFormat)
 */
function getFirstSeriesNumberFormat(
  selectItems: SelectItem[],
  source: SourceResponse | undefined,
): NumberFormat | undefined {
  for (const series of selectItems) {
    if (series.numberFormat) {
      return series.numberFormat;
    }
  }

  for (const series of selectItems) {
    const format = getTraceDurationNumberFormat(source, series);
    if (format) {
      return format;
    }
  }
  return undefined;
}

/**
 * Get the number format to use for a single-series chart type
 * (number / pie / bar).
 *
 * @source packages/app/src/source.ts (useSingleSeriesNumberFormat)
 */
export function resolveSingleSeriesNumberFormat(
  config: ChartConfigWithOptDateRange,
  source: SourceResponse | undefined,
): NumberFormat | undefined {
  if (
    isBuilderChartConfig(config) &&
    Array.isArray(config.select) &&
    config.select.length > 0
  ) {
    if (config.select[0].numberFormat) {
      return config.select[0].numberFormat;
    }

    if (config.numberFormat) {
      return config.numberFormat;
    }

    return getTraceDurationNumberFormat(source, config.select[0]);
  }

  return config.numberFormat;
}

export interface ResolvedNumberFormats {
  /** A map from result column name to resolved number format, if any. */
  formatByColumn: Map<string, NumberFormat>;
  /** The chart-wide number format if present, or the first series-specific number format */
  chartFormat?: NumberFormat;
}

/**
 * Returns the number formats to use when formatting chart series values.
 *
 * @source packages/app/src/source.ts (useChartNumberFormats)
 */
export function resolveChartNumberFormats(
  config: ChartConfigWithOptDateRange,
  source: SourceResponse | undefined,
  meta?: ColumnMetaType[],
): ResolvedNumberFormats {
  // The chart-wide number format does not depend on meta, so that it can be
  // resolved without querying. Further, it prioritizes the config's numberFormat
  // over series-specific formats, so that the user can specify the y-axis format
  // for charts with multiple series-specific formats.
  const chartFormat =
    config.numberFormat ??
    (isBuilderChartConfig(config) && Array.isArray(config.select)
      ? getFirstSeriesNumberFormat(config.select, source)
      : undefined);

  // meta must be provided to map result column names (from meta) to number formats
  if (!meta) {
    return { formatByColumn: new Map(), chartFormat };
  }

  // For Raw-SQL or string-based select configs, series-specific formats are not available
  if (!isBuilderChartConfig(config) || !Array.isArray(config.select)) {
    return { formatByColumn: new Map(), chartFormat };
  }

  // Ratio-based configs have exactly two series, which
  // are merged into the first result column.
  if (isRatioChartConfig(config.select, config)) {
    const effectiveNumberFormat =
      config.select[0]?.numberFormat ??
      config.select[1]?.numberFormat ??
      config.numberFormat;
    const formatByColumn: Map<string, NumberFormat> =
      meta[0] && effectiveNumberFormat
        ? new Map([[meta[0].name, effectiveNumberFormat]])
        : new Map();
    return { formatByColumn, chartFormat };
  }

  // The series-specific number format is mapped to the query meta's column
  // name by index - the assumption is that query result columns are in
  // the order that they exist in the config's select.
  const allColumns = meta.map(column => column.name);
  const formatByColumn = new Map<string, NumberFormat>();
  for (let i = 0; i < config.select.length; i++) {
    const series = config.select[i];
    const key = allColumns[i];
    const effectiveNumberFormat =
      series.numberFormat ??
      config.numberFormat ??
      getTraceDurationNumberFormat(source, series);
    if (effectiveNumberFormat) {
      formatByColumn.set(key, effectiveNumberFormat);
    }
  }

  return { formatByColumn, chartFormat };
}

/**
 * Build a termchart y-axis tick formatter from a chart's number format:
 * compact, no decimals — the same semantics as the web's y-axis.
 * Returns undefined (termchart default formatting) when the chart has
 * no number format.
 *
 * @source packages/app/src/HDXMultiSeriesTimeChart.tsx (tickFormatter)
 */
export function axisTickFormatter(
  numberFormat: NumberFormat | undefined,
): ((value: number) => string) | undefined {
  if (!numberFormat) {
    return undefined;
  }
  return (value: number) =>
    formatNumber(value, {
      ...numberFormat,
      average: true,
      mantissa: 0,
      unit: undefined,
    });
}
