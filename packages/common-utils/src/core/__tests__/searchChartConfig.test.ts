import { DisplayType, Filter, SourceKind, TSource } from '../../types';
import { buildSearchChartConfig } from '../searchChartConfig';

// Factory helpers keep tests focused on the behavior under test rather than
// the full source shape. We cast to TSource because most per-kind fields are
// optional or ignored by buildSearchChartConfig.
const makeLogSource = (overrides: Record<string, unknown> = {}): TSource =>
  ({
    id: 'log-source-1',
    kind: SourceKind.Log,
    name: 'logs',
    connection: 'conn-1',
    from: { databaseName: 'default', tableName: 'otel_logs' },
    timestampValueExpression: 'TimestampTime',
    defaultTableSelectExpression: 'Timestamp, Body',
    implicitColumnExpression: 'Body',
    ...overrides,
  }) as unknown as TSource;

const makeTraceSource = (overrides: Record<string, unknown> = {}): TSource =>
  ({
    id: 'trace-source-1',
    kind: SourceKind.Trace,
    name: 'traces',
    connection: 'conn-1',
    from: { databaseName: 'default', tableName: 'otel_traces' },
    timestampValueExpression: 'Timestamp',
    defaultTableSelectExpression: 'Timestamp, SpanName',
    implicitColumnExpression: 'SpanName',
    ...overrides,
  }) as unknown as TSource;

const makeMetricSource = (overrides: Record<string, unknown> = {}): TSource =>
  ({
    id: 'metric-source-1',
    kind: SourceKind.Metric,
    name: 'metrics',
    connection: 'conn-1',
    from: { databaseName: 'default', tableName: 'otel_metrics' },
    timestampValueExpression: 'TimeUnix',
    ...overrides,
  }) as unknown as TSource;

describe('buildSearchChartConfig', () => {
  describe('tableFilterExpression', () => {
    it('prepends tableFilterExpression as a SQL filter on Log sources', () => {
      const source = makeLogSource({
        tableFilterExpression: "ServiceName != 'noisy'",
      });

      const config = buildSearchChartConfig(source, {
        where: 'Body:"error"',
        whereLanguage: 'lucene',
      });

      expect(config.filters).toEqual([
        { type: 'sql', condition: "ServiceName != 'noisy'" },
      ]);
    });

    it('prepends tableFilterExpression before caller-supplied filters, preserving order', () => {
      const source = makeLogSource({
        tableFilterExpression: "ServiceName != 'noisy'",
      });
      const userFilters: Filter[] = [
        { type: 'sql', condition: "Environment = 'prod'" },
        { type: 'lucene', condition: 'SeverityText:error' },
      ];

      const config = buildSearchChartConfig(source, {
        where: '',
        filters: userFilters,
      });

      expect(config.filters).toEqual([
        { type: 'sql', condition: "ServiceName != 'noisy'" },
        ...userFilters,
      ]);
    });

    it('does not inject any filter when tableFilterExpression is not set', () => {
      const source = makeLogSource();
      const userFilters: Filter[] = [
        { type: 'sql', condition: "Environment = 'prod'" },
      ];

      const config = buildSearchChartConfig(source, {
        where: '',
        filters: userFilters,
      });

      expect(config.filters).toEqual(userFilters);
    });

    it('omits filters key entirely when neither tableFilterExpression nor caller filters are set', () => {
      const config = buildSearchChartConfig(makeLogSource(), { where: '' });

      expect(config.filters).toBeUndefined();
    });

    it('does not inject tableFilterExpression for Trace sources (field is Log-only)', () => {
      // Sanity check: even if someone stuffs the field on a trace source at
      // runtime, it should not be injected because `isLogSource` narrows the check.
      const source = makeTraceSource({
        tableFilterExpression: "ServiceName != 'noisy'",
      });

      const config = buildSearchChartConfig(source, { where: '' });

      expect(config.filters).toBeUndefined();
    });
  });

  describe('implicit column expression', () => {
    it('sets implicitColumnExpression from Log source', () => {
      const source = makeLogSource({
        implicitColumnExpression: "concatWithSeparator(';', Body, Message)",
      });

      const config = buildSearchChartConfig(source, { where: '' });

      expect(config.implicitColumnExpression).toBe(
        "concatWithSeparator(';', Body, Message)",
      );
    });

    it('sets implicitColumnExpression from Trace source', () => {
      const source = makeTraceSource({ implicitColumnExpression: 'SpanName' });

      const config = buildSearchChartConfig(source, { where: '' });

      expect(config.implicitColumnExpression).toBe('SpanName');
    });

    it('leaves implicitColumnExpression undefined for Metric sources', () => {
      const source = makeMetricSource();

      const config = buildSearchChartConfig(source, { where: '' });

      expect(config.implicitColumnExpression).toBeUndefined();
    });
  });

  describe('sample weight expression', () => {
    it('sets sampleWeightExpression from Trace source when sampleRateExpression is set', () => {
      const source = makeTraceSource({
        sampleRateExpression: 'SpanAttributes.sampleWeight',
      });

      const config = buildSearchChartConfig(source, { where: '' });

      expect(config.sampleWeightExpression).toBe('SpanAttributes.sampleWeight');
    });

    it('leaves sampleWeightExpression undefined for Trace source without sampleRateExpression', () => {
      const source = makeTraceSource();

      const config = buildSearchChartConfig(source, { where: '' });

      expect(config.sampleWeightExpression).toBeUndefined();
    });

    it('leaves sampleWeightExpression undefined for Log source even if sampleRateExpression is present', () => {
      const source = makeLogSource({
        sampleRateExpression: 'LogAttributes.sampleWeight',
      });

      const config = buildSearchChartConfig(source, { where: '' });

      expect(config.sampleWeightExpression).toBeUndefined();
    });
  });

  describe('select precedence', () => {
    it('prefers caller-provided select over all fallbacks', () => {
      const source = makeLogSource({
        defaultTableSelectExpression: 'source-default',
      });

      const config = buildSearchChartConfig(source, {
        where: '',
        select: 'caller-select',
        defaultSelect: 'caller-default',
      });

      expect(config.select).toBe('caller-select');
    });

    it('falls back to defaultSelect when select is empty string', () => {
      const source = makeLogSource({
        defaultTableSelectExpression: 'source-default',
      });

      const config = buildSearchChartConfig(source, {
        where: '',
        select: '',
        defaultSelect: 'caller-default',
      });

      expect(config.select).toBe('caller-default');
    });

    it('falls back to source defaultTableSelectExpression when caller fields are missing', () => {
      const source = makeLogSource({
        defaultTableSelectExpression: 'source-default',
      });

      const config = buildSearchChartConfig(source, { where: '' });

      expect(config.select).toBe('source-default');
    });

    it('supports array-valued SELECT (count aggregate) for alert-style queries', () => {
      const source = makeLogSource();
      const selectList = [
        { aggFn: 'count' as const, aggCondition: '', valueExpression: '' },
      ];

      const config = buildSearchChartConfig(source, {
        where: '',
        defaultSelect: selectList,
      });

      expect(config.select).toEqual(selectList);
    });
  });

  describe('whereLanguage default', () => {
    it('defaults whereLanguage to "sql" when not provided', () => {
      const config = buildSearchChartConfig(makeLogSource(), { where: '' });

      expect(config.whereLanguage).toBe('sql');
    });

    it('passes through whereLanguage when provided', () => {
      const config = buildSearchChartConfig(makeLogSource(), {
        where: 'Body:"error"',
        whereLanguage: 'lucene',
      });

      expect(config.whereLanguage).toBe('lucene');
    });
  });

  describe('pass-through fields', () => {
    it('passes through all time-range and display settings', () => {
      const source = makeLogSource();
      const dateRange: [Date, Date] = [
        new Date('2026-04-24T09:50:00.000Z'),
        new Date('2026-04-24T09:55:00.000Z'),
      ];

      const config = buildSearchChartConfig(source, {
        where: '',
        displayType: DisplayType.Line,
        dateRange,
        dateRangeStartInclusive: true,
        dateRangeEndInclusive: false,
        granularity: '5 minute',
        groupBy: 'ServiceName',
      });

      expect(config.displayType).toBe(DisplayType.Line);
      expect(config.dateRange).toBe(dateRange);
      expect(config.dateRangeStartInclusive).toBe(true);
      expect(config.dateRangeEndInclusive).toBe(false);
      expect(config.granularity).toBe('5 minute');
      expect(config.groupBy).toBe('ServiceName');
    });

    it('pulls from, timestampValueExpression, and source id from the source', () => {
      const source = makeLogSource();

      const config = buildSearchChartConfig(source, { where: '' });

      expect(config.from).toEqual({
        databaseName: 'default',
        tableName: 'otel_logs',
      });
      expect(config.timestampValueExpression).toBe('TimestampTime');
      expect(config.source).toBe('log-source-1');
    });

    it('defaults connection to source.connection and allows override', () => {
      const source = makeLogSource({ connection: 'source-conn' });

      const fromSource = buildSearchChartConfig(source, { where: '' });
      expect(fromSource.connection).toBe('source-conn');

      const overridden = buildSearchChartConfig(source, {
        where: '',
        connection: 'override-conn',
      });
      expect(overridden.connection).toBe('override-conn');
    });

    it('defaults displayType to Search when not provided', () => {
      const config = buildSearchChartConfig(makeLogSource(), { where: '' });

      expect(config.displayType).toBe(DisplayType.Search);
    });
  });

  describe('end-to-end shape parity with DBSearchPage', () => {
    // Mirrors the key fields the app search page historically produced so
    // downstream components depending on that shape keep working.
    it('produces the same filters ordering as DBSearchPage for tableFilterExpression + user filters', () => {
      const source = makeLogSource({
        tableFilterExpression: "ServiceName NOT IN ('hidden')",
      });
      const userFilter: Filter = {
        type: 'lucene',
        condition: 'Level:error',
      };

      const config = buildSearchChartConfig(source, {
        where: 'Body:"oops"',
        whereLanguage: 'lucene',
        filters: [userFilter],
      });

      expect(config.filters?.[0]).toEqual({
        type: 'sql',
        condition: "ServiceName NOT IN ('hidden')",
      });
      expect(config.filters?.[1]).toEqual(userFilter);
    });
  });
});
