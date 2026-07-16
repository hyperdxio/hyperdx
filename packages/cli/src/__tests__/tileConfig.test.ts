import { describe, expect, it } from '@jest/globals';

import { DisplayType } from '@hyperdx/common-utils/dist/types';
import type { SavedChartConfig } from '@hyperdx/common-utils/dist/types';

import type { SourceResponse } from '@/api/client';
import {
  convertTileConfigForQuery,
  convertToNumberChartConfig,
  convertToTableChartConfig,
  convertToTimeChartConfig,
  getMetricTableName,
  parseGranularityFlag,
  resolveTileConfig,
  sortTilesForDisplay,
} from '@/shared/tileConfig';

const dateRange: [Date, Date] = [
  new Date('2026-07-10T00:00:00Z'),
  new Date('2026-07-10T01:00:00Z'),
];

const logSource: SourceResponse = {
  id: 'src-1',
  _id: 'src-1',
  name: 'Logs',
  kind: 'log',
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'TimestampTime',
  implicitColumnExpression: 'Body',
  bodyExpression: 'Body',
};

const traceSource: SourceResponse = {
  id: 'src-2',
  _id: 'src-2',
  name: 'Traces',
  kind: 'trace',
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  durationExpression: 'Duration',
  sampleRateExpression: 'SampleRate',
};

const metricSource: SourceResponse = {
  id: 'src-3',
  _id: 'src-3',
  name: 'Metrics',
  kind: 'metric',
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: '' },
  timestampValueExpression: 'TimeUnix',
  metricTables: {
    gauge: 'otel_metrics_gauge',
    sum: 'otel_metrics_sum',
    histogram: 'otel_metrics_histogram',
    summary: 'otel_metrics_summary',
    'exponential histogram': 'otel_metrics_exp_histogram',
  },
};

const builderConfig: SavedChartConfig = {
  name: 'Requests',
  source: 'src-1',
  displayType: DisplayType.Line,
  select: [{ aggFn: 'count', aggCondition: '', valueExpression: '' }],
  where: '',
  whereLanguage: 'lucene',
};

describe('resolveTileConfig', () => {
  it('resolves a builder config against a log source (web Tile parity)', () => {
    const result = resolveTileConfig({
      config: builderConfig,
      source: logSource,
      dateRange,
      granularity: '5 minute',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toMatchObject({
      connection: 'conn-1',
      timestampValueExpression: 'TimestampTime',
      from: { databaseName: 'default', tableName: 'otel_logs' },
      implicitColumnExpression: 'Body',
      bodyExpression: 'Body',
      granularity: '5 minute',
      dateRange,
    });
    // Log sources have no sample weight
    expect(
      (result.config as Record<string, unknown>).sampleWeightExpression,
    ).toBeUndefined();
  });

  it('sets sampleWeightExpression for trace sources', () => {
    const result = resolveTileConfig({
      config: { ...builderConfig, source: 'src-2' },
      source: traceSource,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      (result.config as Record<string, unknown>).sampleWeightExpression,
    ).toBe('SampleRate');
  });

  it('resolves metric source table from the first select metricType', () => {
    const result = resolveTileConfig({
      config: {
        ...builderConfig,
        source: 'src-3',
        select: [
          {
            aggFn: 'avg',
            aggCondition: '',
            valueExpression: 'Value',
            metricType: 'gauge',
            metricName: 'cpu.utilization',
          },
        ],
      } as SavedChartConfig,
      source: metricSource,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.from).toEqual({
      databaseName: 'default',
      tableName: 'otel_metrics_gauge',
    });
    expect((result.config as Record<string, unknown>).metricTables).toEqual(
      metricSource.metricTables,
    );
  });

  it('passes through raw SQL configs without a source', () => {
    const rawConfig: SavedChartConfig = {
      name: 'Raw',
      configType: 'sql',
      sqlTemplate: 'SELECT count() FROM t',
      connection: 'conn-1',
      displayType: DisplayType.Number,
    };
    const result = resolveTileConfig({
      config: rawConfig,
      source: undefined,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toMatchObject({
      sqlTemplate: 'SELECT count() FROM t',
      dateRange,
    });
  });

  it('merges source fields into raw SQL configs with a source', () => {
    const rawConfig: SavedChartConfig = {
      name: 'Raw',
      configType: 'sql',
      sqlTemplate: 'SELECT count() FROM $__sourceTable',
      connection: 'conn-1',
      source: 'src-1',
      displayType: DisplayType.Number,
    };
    const result = resolveTileConfig({
      config: rawConfig,
      source: logSource,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toMatchObject({
      from: { databaseName: 'default', tableName: 'otel_logs' },
      implicitColumnExpression: 'Body',
      bodyExpression: 'Body',
    });
  });

  it('reports missing sources', () => {
    const result = resolveTileConfig({
      config: builderConfig,
      source: undefined,
      dateRange,
    });
    expect(result).toMatchObject({ ok: false, reason: 'source-missing' });
  });

  it('rejects PromQL configs as unsupported', () => {
    const result = resolveTileConfig({
      config: {
        name: 'PromQL',
        configType: 'promql',
        promqlExpression: 'up',
        connection: 'conn-1',
        displayType: DisplayType.Line,
      } as SavedChartConfig,
      source: undefined,
      dateRange,
    });
    expect(result).toMatchObject({ ok: false, reason: 'promql-unsupported' });
  });
});

describe('convertToTimeChartConfig', () => {
  const resolved = (() => {
    const r = resolveTileConfig({
      config: builderConfig,
      source: logSource,
      dateRange,
    });
    if (!r.ok) throw new Error('unexpected');
    return r.config;
  })();

  it('resolves auto granularity and aligns the date range (web parity)', () => {
    const converted = convertToTimeChartConfig(resolved);
    // 1 hour / 80 buckets → "1 minute" granularity (same as the web)
    expect(converted.granularity).toBe('1 minute');
    expect(converted.dateRangeEndInclusive).toBe(false);
    if ('limit' in converted) {
      expect(converted.limit).toEqual({ limit: 100000 });
    }
  });

  it('respects explicit granularity', () => {
    const converted = convertToTimeChartConfig({
      ...resolved,
      granularity: '10 minute',
    });
    expect(converted.granularity).toBe('10 minute');
  });

  it('honors maxBuckets for terminal-width bucket capping', () => {
    const converted = convertToTimeChartConfig(resolved, 40);
    // 1 hour / 40 buckets → 2 min buckets round up to "5 minute"
    expect(converted.granularity).toBe('5 minute');
  });
});

describe('convertToNumberChartConfig / convertToTableChartConfig', () => {
  const resolved = (() => {
    const r = resolveTileConfig({
      config: {
        ...builderConfig,
        displayType: DisplayType.Table,
        groupBy: 'ServiceName',
        granularity: '1 minute',
      } as SavedChartConfig,
      source: logSource,
      dateRange,
    });
    if (!r.ok) throw new Error('unexpected');
    return r.config;
  })();

  it('drops granularity and groupBy for number charts', () => {
    const converted = convertToNumberChartConfig(resolved);
    expect(converted.granularity).toBeUndefined();
    expect(
      'groupBy' in converted ? converted.groupBy : undefined,
    ).toBeUndefined();
  });

  it('applies table defaults (limit 200 + orderBy from groupBy)', () => {
    const converted = convertToTableChartConfig(resolved);
    expect(converted.granularity).toBeUndefined();
    if ('limit' in converted) {
      expect(converted.limit).toEqual({ limit: 200 });
    }
    if ('orderBy' in converted) {
      expect(converted.orderBy).toBe('ServiceName');
    }
  });
});

describe('convertTileConfigForQuery', () => {
  it('dispatches by displayType', () => {
    const r = resolveTileConfig({
      config: builderConfig,
      source: logSource,
      dateRange,
    });
    if (!r.ok) throw new Error('unexpected');

    const line = convertTileConfigForQuery(r.config);
    expect(line.granularity).toBe('1 minute');

    const number = convertTileConfigForQuery({
      ...r.config,
      displayType: DisplayType.Number,
    });
    expect(number.granularity).toBeUndefined();
  });
});

describe('getMetricTableName', () => {
  it('returns from.tableName when no metric type given', () => {
    expect(getMetricTableName(logSource)).toBe('otel_logs');
  });
  it('resolves metric table by kind (case-insensitive)', () => {
    expect(getMetricTableName(metricSource, 'Gauge')).toBe(
      'otel_metrics_gauge',
    );
    expect(getMetricTableName(metricSource, 'sum')).toBe('otel_metrics_sum');
  });
  it('returns undefined for non-metric sources with a metric type', () => {
    expect(getMetricTableName(logSource, 'gauge')).toBeUndefined();
  });
});

describe('sortTilesForDisplay', () => {
  it('sorts by grid y then x', () => {
    const tiles = [
      { id: 'c', x: 0, y: 4 },
      { id: 'b', x: 12, y: 0 },
      { id: 'a', x: 0, y: 0 },
    ];
    expect(sortTilesForDisplay(tiles).map(t => t.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('parseGranularityFlag', () => {
  it('maps "auto" to undefined so the pipeline picks', () => {
    expect(parseGranularityFlag('auto')).toEqual({ granularity: undefined });
  });

  it.each(['30 second', '1 minute', '5 minute', '12 hour', '1 day'])(
    'accepts supported interval %s',
    value => {
      expect(parseGranularityFlag(value)).toEqual({ granularity: value });
    },
  );

  it('trims surrounding whitespace', () => {
    expect(parseGranularityFlag(' 5 minute ')).toEqual({
      granularity: '5 minute',
    });
  });

  it.each([
    // week+ units are unsupported by the shaping pipeline — accepting
    // them previously hung empty-bucket generation forever
    '1 week',
    '1 month',
    '1 quarter',
    '1 year',
    '0 minute',
    '-5 minute',
    '1.5 hour',
    'banana',
    '',
  ])('rejects unsupported value %j', value => {
    expect(parseGranularityFlag(value)).toBeNull();
  });
});
