import { describe, expect, it } from '@jest/globals';

import { DisplayType } from '@hyperdx/common-utils/dist/types';

import type { SourceResponse } from '@/api/client';
import {
  AdhocChartError,
  buildAdhocChartConfig,
  findSource,
  parseDisplayType,
} from '@/shared/adhocChart';
import { stripAnsi } from '@/shared/ansiChart';

const logSource: SourceResponse = {
  id: 'src-1',
  _id: 'src-1',
  name: 'Logs',
  kind: 'log',
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'TimestampTime',
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

const sources = [logSource, metricSource];

describe('buildAdhocChartConfig — builder mode', () => {
  it('builds a default count line chart', () => {
    const { config, source, label } = buildAdhocChartConfig(
      { source: 'Logs' },
      sources,
    );
    expect(source).toBe(logSource);
    expect(config).toMatchObject({
      source: 'src-1',
      displayType: DisplayType.Line,
      where: '',
      whereLanguage: 'lucene',
    });
    expect((config as { select: unknown[] }).select).toEqual([
      {
        aggFn: 'count',
        aggCondition: '',
        aggConditionLanguage: 'lucene',
        valueExpression: '',
      },
    ]);
    expect(label).toContain('count');
  });

  it('supports where / group-by / display / sql language', () => {
    const { config } = buildAdhocChartConfig(
      {
        source: 'src-1',
        display: 'bar',
        where: "SeverityText = 'error'",
        language: 'sql',
        groupBy: 'ServiceName',
      },
      sources,
    );
    expect(config).toMatchObject({
      displayType: DisplayType.Bar,
      where: "SeverityText = 'error'",
      whereLanguage: 'sql',
      groupBy: 'ServiceName',
    });
  });

  it('builds quantile series with default level', () => {
    const { config } = buildAdhocChartConfig(
      { source: 'Logs', agg: 'quantile', value: 'Duration' },
      sources,
    );
    expect((config as { select: unknown[] }).select[0]).toMatchObject({
      aggFn: 'quantile',
      valueExpression: 'Duration',
      level: 0.95,
    });
  });

  it('requires --value for non-count aggregations', () => {
    expect(() =>
      buildAdhocChartConfig({ source: 'Logs', agg: 'avg' }, sources),
    ).toThrow(AdhocChartError);
  });

  it('builds metric select items with Value default', () => {
    const { config } = buildAdhocChartConfig(
      {
        source: 'Metrics',
        agg: 'sum',
        metricType: 'sum',
        metricName: 'otelcol_exporter_sent_spans',
      },
      sources,
    );
    expect((config as { select: unknown[] }).select[0]).toMatchObject({
      metricType: 'sum',
      metricName: 'otelcol_exporter_sent_spans',
      valueExpression: 'Value',
    });
  });

  it('rejects metric flags on non-metric sources', () => {
    expect(() =>
      buildAdhocChartConfig(
        { source: 'Logs', metricType: 'sum', metricName: 'x' },
        sources,
      ),
    ).toThrow(/metric source/);
  });

  it('accepts repeatable --series JSON items', () => {
    const { config } = buildAdhocChartConfig(
      {
        source: 'Logs',
        series: [
          '{"aggFn":"count"}',
          '{"aggFn":"avg","valueExpression":"Duration","alias":"Avg"}',
        ],
      },
      sources,
    );
    const select = (config as { select: Array<Record<string, unknown>> })
      .select;
    expect(select).toHaveLength(2);
    expect(select[1]).toMatchObject({
      aggFn: 'avg',
      valueExpression: 'Duration',
      alias: 'Avg',
    });
  });

  it('rejects invalid --series JSON', () => {
    expect(() =>
      buildAdhocChartConfig({ source: 'Logs', series: ['not json'] }, sources),
    ).toThrow(/not valid JSON/);
  });

  it('errors on unknown source', () => {
    expect(() => buildAdhocChartConfig({ source: 'nope' }, sources)).toThrow(
      /not found/,
    );
  });
});

describe('buildAdhocChartConfig — raw SQL mode', () => {
  it('uses the source connection when --source is given', () => {
    const { config } = buildAdhocChartConfig(
      { sql: 'SELECT 1', source: 'Logs', display: 'number' },
      sources,
    );
    expect(config).toMatchObject({
      configType: 'sql',
      sqlTemplate: 'SELECT 1',
      connection: 'conn-1',
      source: 'src-1',
      displayType: DisplayType.Number,
    });
  });

  it('accepts --connection-id without a source', () => {
    const { config, source } = buildAdhocChartConfig(
      { sql: 'SELECT 1', connectionId: 'conn-9' },
      sources,
    );
    expect(source).toBeUndefined();
    expect(config).toMatchObject({ connection: 'conn-9' });
  });

  it('requires a connection', () => {
    expect(() => buildAdhocChartConfig({ sql: 'SELECT 1' }, sources)).toThrow(
      /--source|--connection-id/,
    );
  });
});

describe('parseDisplayType', () => {
  it('defaults to line and validates values', () => {
    expect(parseDisplayType(undefined)).toBe(DisplayType.Line);
    expect(parseDisplayType('pie')).toBe(DisplayType.Pie);
    expect(() => parseDisplayType('heatmap')).toThrow(AdhocChartError);
  });
});

describe('findSource', () => {
  it('matches by id, _id, and case-insensitive name', () => {
    expect(findSource(sources, 'src-1')).toBe(logSource);
    expect(findSource(sources, 'logs')).toBe(logSource);
    expect(findSource(sources, 'METRICS')).toBe(metricSource);
    expect(findSource(sources, 'missing')).toBeUndefined();
  });
});

describe('stripAnsi', () => {
  it('removes color escape codes but keeps drawing characters', () => {
    const colored = '\u001b[34m╭──╮\u001b[0m █▇▆ \u001b[91mred\u001b[39m';
    expect(stripAnsi(colored)).toBe('╭──╮ █▇▆ red');
  });
});
