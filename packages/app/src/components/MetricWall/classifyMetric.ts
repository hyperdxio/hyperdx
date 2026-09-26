import { MetricsDataType } from '@hyperdx/common-utils/dist/types';

export const METRIC_QUANTITIES = [
  'latency',
  'errors',
  'throughput',
  'saturation',
  'queue',
  'unclassified',
] as const;

export type MetricQuantity = (typeof METRIC_QUANTITIES)[number];

export const METRIC_QUANTITY_LABELS: Record<MetricQuantity, string> = {
  latency: 'Latency',
  errors: 'Errors & counts',
  throughput: 'Throughput',
  saturation: 'Saturation',
  queue: 'Queue depth',
  unclassified: 'Unclassified',
};

/** Which of the four signals decided the band, shown on the tile caption. */
type ClassificationReason = 'unit' | 'name' | 'kind' | 'fallback';

export type MetricClassification = {
  quantity: MetricQuantity;
  reason: ClassificationReason;
};

const TIME_UNITS = new Set(['ns', 'us', 'ms', 's', 'min', 'h', 'd']);
const BYTE_UNITS = /^(bit|By|KBy|MBy|GBy|KiBy|MiBy|GiBy|TiBy)$/;

// Tails that name what a metric measures, checked longest first so
// `seconds_total` wins over `total`.
const NAME_TAILS: [string, MetricQuantity][] = [
  ['seconds_total', 'latency'],
  ['duration', 'latency'],
  ['latency', 'latency'],
  ['errors', 'errors'],
  ['error', 'errors'],
  ['failures', 'errors'],
  ['count', 'errors'],
  ['total', 'errors'],
  ['bytes', 'saturation'],
  ['usage', 'saturation'],
  ['utilization', 'saturation'],
  ['used', 'saturation'],
  ['load1', 'saturation'],
  ['load5', 'saturation'],
  ['load15', 'saturation'],
  ['lag', 'queue'],
  ['queue', 'queue'],
  ['depth', 'queue'],
  ['backlog', 'queue'],
];

function nameTokens(name: string): string[] {
  return name.split(/[._]/).filter(Boolean);
}

function isCpuTime(name: string): boolean {
  return nameTokens(name).some(t => t.toLowerCase() === 'cpu');
}

function classifyByUnit(
  unit: string,
  name: string,
): MetricQuantity | undefined {
  if (unit.endsWith('/s')) return 'throughput';
  if (unit === '%') return 'saturation';
  if (BYTE_UNITS.test(unit)) return 'saturation';
  // CPU time is a resource footprint, not how long something took.
  if (TIME_UNITS.has(unit)) return isCpuTime(name) ? 'saturation' : 'latency';
  return undefined;
}

function classifyByName(name: string): MetricQuantity | undefined {
  const tokens = nameTokens(name.toLowerCase());
  const lastTwo = tokens.slice(-2).join('_');
  const last = tokens[tokens.length - 1] ?? '';
  for (const [tail, quantity] of NAME_TAILS) {
    if (lastTwo === tail || last === tail) {
      if (tail === 'seconds_total' && isCpuTime(name)) return 'saturation';
      return quantity;
    }
  }
  return undefined;
}

/**
 * Band a metric by what it measures. Four signals in order, each less
 * trustworthy than the one before: the declared unit, the tail of the name
 * (the head only says who emitted it), the kind, then an honest
 * "Unclassified" rather than a confident guess.
 */
export function classifyMetric({
  name,
  type,
  unit,
}: {
  name: string;
  type: MetricsDataType;
  unit?: string;
}): MetricClassification {
  const byUnit = unit ? classifyByUnit(unit, name) : undefined;
  if (byUnit) return { quantity: byUnit, reason: 'unit' };

  const byName = classifyByName(name);
  if (byName) return { quantity: byName, reason: 'name' };

  // A dimensionless sum is a counter whatever it is called. With no declared
  // unit at all there is nothing to say it was meant as one.
  if (unit && type === MetricsDataType.Sum) {
    return { quantity: 'errors', reason: 'kind' };
  }
  return { quantity: 'unclassified', reason: 'fallback' };
}
