import { COLORS } from '@/utils';

import type { TimelineEvent, TimelineLane } from './types';

type ColumnMeta = {
  name: string;
  type: string;
};

type ClickHouseResponse = {
  data: Record<string, any>[];
  meta?: ColumnMeta[];
};

function isDateTimeType(type: string): boolean {
  return /^(DateTime|DateTime64|Date|Nullable\(DateTime)/i.test(type);
}

function findColumnByName(
  meta: ColumnMeta[],
  name: string,
): ColumnMeta | undefined {
  // Try exact match first, then case-insensitive, then with backtick-stripped
  return (
    meta.find(col => col.name === name) ??
    meta.find(col => col.name.toLowerCase() === name.toLowerCase()) ??
    meta.find(
      col => col.name.replace(/`/g, '').toLowerCase() === name.toLowerCase(),
    )
  );
}

function findTimestampColumn(meta: ColumnMeta[]): ColumnMeta | undefined {
  const byName = findColumnByName(meta, 'ts');
  if (byName) return byName;
  return meta.find(col => isDateTimeType(col.type));
}

function findLabelColumn(
  meta: ColumnMeta[],
  tsColName: string,
): ColumnMeta | undefined {
  // Explicit name match first
  const byName = findColumnByName(meta, 'label');
  if (byName) return byName;

  // Fall back to first string-like column that isn't ts/group/severity/__series
  const reserved = new Set([
    tsColName.toLowerCase(),
    'group',
    'severity',
    '__series',
  ]);
  return meta.find(
    col =>
      !isDateTimeType(col.type) &&
      !reserved.has(col.name.toLowerCase()) &&
      !reserved.has(col.name.replace(/`/g, '').toLowerCase()),
  );
}

function toUnixSeconds(value: any): number {
  if (typeof value === 'number') {
    return value > 4_102_444_800 ? value / 1000 : value;
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return d.getTime() / 1000;
  }
  return 0;
}

export function formatTimelineResponse(response: ClickHouseResponse): {
  events: TimelineEvent[];
  lanes: TimelineLane[];
} {
  const { data, meta } = response;

  if (!data || data.length === 0 || !meta || meta.length === 0) {
    return { events: [], lanes: [] };
  }

  const tsCol = findTimestampColumn(meta);
  if (!tsCol) {
    // No usable timestamp column; bail out silently. The renderer will
    // show the empty time axis. We deliberately do not log here because
    // this code runs on every chart re-render; a noisy warn was previously
    // tripping the dev console on every page load.
    return { events: [], lanes: [] };
  }

  const labelCol = findLabelColumn(meta, tsCol.name);
  const groupCol = findColumnByName(meta, 'group');
  const severityCol = findColumnByName(meta, 'severity');
  const seriesCol = findColumnByName(meta, '__series');

  const events: TimelineEvent[] = data.map(row => ({
    ts: toUnixSeconds(row[tsCol.name]),
    label: labelCol ? String(row[labelCol.name] ?? '') : '',
    group: groupCol ? String(row[groupCol.name] ?? '') : undefined,
    severity: severityCol ? String(row[severityCol.name] ?? '') : undefined,
    series: seriesCol ? String(row[seriesCol.name] ?? '') : undefined,
  }));

  // Build lanes: group by __series first, then by group
  const laneMap = new Map<string, TimelineEvent[]>();
  for (const event of events) {
    const laneKey = event.series || event.group || '_default';
    const existing = laneMap.get(laneKey);
    if (existing) {
      existing.push(event);
    } else {
      laneMap.set(laneKey, [event]);
    }
  }

  const lanes: TimelineLane[] = Array.from(laneMap.entries()).map(
    ([key, laneEvents], index) => ({
      key,
      displayName: key === '_default' ? 'Events' : key,
      events: laneEvents,
      color: COLORS[index % COLORS.length],
    }),
  );

  return { events, lanes };
}
