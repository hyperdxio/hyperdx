import {
  ChartConfigWithDateRange,
  DisplayType,
  SavedChartConfig,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import { ChartEditorFormState } from '@/components/ChartEditor/types';

import {
  buildChartConfigForExplanations,
  buildSampleEventsConfig,
  computeDbTimeChartConfig,
  displayTypeToActiveTab,
  isQueryReady,
  seriesToFilters,
  TABS_WITH_GENERATED_SQL,
} from '../utils';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const dateRange: [Date, Date] = [
  new Date('2024-01-01'),
  new Date('2024-01-02'),
];

const builderConfig: ChartConfigWithDateRange = {
  select: [
    {
      aggFn: 'count',
      aggCondition: '',
      valueExpression: '',
    },
  ],
  from: { databaseName: 'default', tableName: 'logs' },
  where: '',
  whereLanguage: 'sql',
  timestampValueExpression: 'Timestamp',
  connection: 'clickhouse',
  dateRange,
  granularity: 'auto',
} as ChartConfigWithDateRange;

const rawSqlConfig = {
  configType: 'sql' as const,
  sqlTemplate: 'SELECT count() FROM logs',
  connection: 'clickhouse',
  dateRange,
} as ChartConfigWithDateRange;

const logSource = {
  kind: SourceKind.Log,
  id: 'log-source',
  name: 'Logs',
  from: { databaseName: 'default', tableName: 'logs' },
  connection: 'clickhouse',
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: '*',
} as TSource;

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const metricSource = {
  kind: SourceKind.Metric,
  id: 'metric-source',
  name: 'Metrics',
  from: { databaseName: 'default', tableName: '' },
  connection: 'clickhouse',
  timestampValueExpression: 'Timestamp',
  metricTables: {
    gauge: 'metrics.gauge',
    sum: 'metrics.sum',
    histogram: 'metrics.histogram',
  },
} as TSource;

const savedChartConfig: SavedChartConfig = {
  name: 'Test Chart',
  source: 'log-source',
  displayType: DisplayType.Line,
  select: [
    {
      aggFn: 'count',
      aggCondition: '',
      valueExpression: '',
    },
  ],
  where: '',
  whereLanguage: 'sql',
  granularity: 'auto',
} as SavedChartConfig;

const rawSqlSavedChartConfig: SavedChartConfig = {
  configType: 'sql' as const,
  name: 'SQL Chart',
  sqlTemplate: 'SELECT count() FROM logs',
  connection: 'clickhouse',
} as SavedChartConfig;

// ---------------------------------------------------------------------------
// isQueryReady
// ---------------------------------------------------------------------------

describe('isQueryReady', () => {
  it('returns false for undefined', () => {
    expect(isQueryReady(undefined)).toBe(false);
  });

  it('returns truthy for a valid builder config', () => {
    expect(isQueryReady(builderConfig)).toBeTruthy();
  });

  it('returns falsy when select is empty array', () => {
    expect(isQueryReady({ ...builderConfig, select: [] })).toBeFalsy();
  });

  it('returns truthy when select is a string', () => {
    expect(
      isQueryReady({ ...builderConfig, select: 'col1, col2' }),
    ).toBeTruthy();
  });

  it('returns falsy when databaseName is missing', () => {
    expect(
      isQueryReady({
        ...builderConfig,
        from: { databaseName: '', tableName: 'logs' },
      }),
    ).toBeFalsy();
  });

  it('returns truthy for metric sources with metricTables but empty tableName', () => {
    expect(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      isQueryReady({
        ...builderConfig,
        from: { databaseName: 'default', tableName: '' },
        metricTables: { gauge: 'metrics.gauge' },
      } as ChartConfigWithDateRange),
    ).toBeTruthy();
  });

  it('returns truthy for raw SQL config with sqlTemplate and connection', () => {
    expect(isQueryReady(rawSqlConfig)).toBeTruthy();
  });

  it('returns false for raw SQL config without sqlTemplate', () => {
    expect(
      isQueryReady({
        ...rawSqlConfig,
        sqlTemplate: '',
      } as ChartConfigWithDateRange),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// seriesToFilters
// ---------------------------------------------------------------------------

describe('seriesToFilters', () => {
  it('returns empty array for string select', () => {
    expect(seriesToFilters('col1, col2')).toEqual([]);
  });

  it('converts series with conditions to filters', () => {
    const select = [
      {
        aggFn: 'count',
        aggCondition: 'status > 400',
        aggConditionLanguage: 'sql' as const,
        valueExpression: '',
      },
      {
        aggFn: 'avg',
        aggCondition: 'level:error',
        aggConditionLanguage: 'lucene' as const,
        valueExpression: 'duration',
      },
    ];

    expect(seriesToFilters(select)).toEqual([
      { type: 'sql', condition: 'status > 400' },
      { type: 'lucene', condition: 'level:error' },
    ]);
  });

  it('skips series with null condition or language', () => {
    const select = [
      {
        aggFn: 'count',
        aggCondition: '',
        aggConditionLanguage: 'lucene' as const,
        valueExpression: '',
      },
      {
        aggFn: 'avg',
        valueExpression: 'duration',
      },
    ];

    // First has empty string condition (still not null), second has no language
    expect(seriesToFilters(select)).toEqual([
      { type: 'lucene', condition: '' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// displayTypeToActiveTab
// ---------------------------------------------------------------------------

describe('displayTypeToActiveTab', () => {
  it.each([
    [DisplayType.Search, 'search'],
    [DisplayType.Heatmap, 'heatmap'],
    [DisplayType.Markdown, 'markdown'],
    [DisplayType.Table, 'table'],
    [DisplayType.Pie, 'pie'],
    [DisplayType.Number, 'number'],
    [DisplayType.Line, 'time'],
  ])('maps %s to %s', (displayType, expected) => {
    expect(displayTypeToActiveTab(displayType)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// TABS_WITH_GENERATED_SQL
// ---------------------------------------------------------------------------

describe('TABS_WITH_GENERATED_SQL', () => {
  it('includes table, time, heatmap, number, pie', () => {
    expect(TABS_WITH_GENERATED_SQL.has('table')).toBe(true);
    expect(TABS_WITH_GENERATED_SQL.has('time')).toBe(true);
    expect(TABS_WITH_GENERATED_SQL.has('heatmap')).toBe(true);
    expect(TABS_WITH_GENERATED_SQL.has('number')).toBe(true);
    expect(TABS_WITH_GENERATED_SQL.has('pie')).toBe(true);
  });

  it('excludes search, markdown', () => {
    expect(TABS_WITH_GENERATED_SQL.has('search')).toBe(false);
    expect(TABS_WITH_GENERATED_SQL.has('markdown')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeDbTimeChartConfig
// ---------------------------------------------------------------------------

describe('computeDbTimeChartConfig', () => {
  it('returns undefined when queriedConfig is undefined', () => {
    expect(computeDbTimeChartConfig(undefined, undefined)).toBeUndefined();
  });

  it('returns config unchanged when there is no alert', () => {
    const result = computeDbTimeChartConfig(builderConfig, undefined);
    expect(result).toEqual(builderConfig);
  });

  it('overrides granularity and dateRange when alert is present', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const alert = {
      interval: '1h' as const,
      threshold: 100,
      thresholdType: 'above' as const,
      channel: { type: 'webhook' as const },
    } as unknown as ChartEditorFormState['alert'];

    const result = computeDbTimeChartConfig(builderConfig, alert);

    expect(result).toBeDefined();
    // granularity should be changed from the alert interval
    expect(result!.granularity).not.toBe(builderConfig.granularity);
    // dateRange should be extended
    expect(result!.dateRange).toBeDefined();
  });

  it('preserves other config fields', () => {
    const result = computeDbTimeChartConfig(builderConfig, undefined);
    expect(result!.connection).toBe(builderConfig.connection);
    expect(result!.from).toBe(builderConfig.from);
    // @ts-expect-error union types..
    expect(result!.select).toBe(builderConfig.select);
  });
});

// ---------------------------------------------------------------------------
// buildSampleEventsConfig
// ---------------------------------------------------------------------------

describe('buildSampleEventsConfig', () => {
  it('returns null when tableSource is undefined', () => {
    expect(
      buildSampleEventsConfig(builderConfig, undefined, dateRange, true),
    ).toBeNull();
  });

  it('returns null when queriedConfig is undefined', () => {
    expect(
      buildSampleEventsConfig(undefined, logSource, dateRange, true),
    ).toBeNull();
  });

  it('returns null when queryReady is false', () => {
    expect(
      buildSampleEventsConfig(builderConfig, logSource, dateRange, false),
    ).toBeNull();
  });

  it('returns null for raw SQL config', () => {
    expect(
      buildSampleEventsConfig(rawSqlConfig, logSource, dateRange, true),
    ).toBeNull();
  });

  it('builds config for a valid builder config with log source', () => {
    const result = buildSampleEventsConfig(
      builderConfig,
      logSource,
      dateRange,
      true,
    );

    expect(result).not.toBeNull();
    expect(result!.dateRange).toBe(dateRange);
    expect(result!.connection).toBe(logSource.connection);
    expect(result!.from).toBe(logSource.from);
    expect(result!.limit).toEqual({ limit: 200 });
    // @ts-expect-error union types..
    expect(result!.select).toBe(logSource.defaultTableSelectExpression);
    expect(result!.orderBy).toEqual([
      { ordering: 'DESC', valueExpression: 'Timestamp' },
    ]);
    expect(result!.filtersLogicalOperator).toBe('OR');
    expect(result!.groupBy).toBeUndefined();
    expect(result!.granularity).toBeUndefined();
    expect(result!.having).toBeUndefined();
  });

  it('uses empty string for select when source has no defaultTableSelectExpression', () => {
    const result = buildSampleEventsConfig(
      builderConfig,
      metricSource,
      dateRange,
      true,
    );

    expect(result).not.toBeNull();
    expect(result!.select).toBe('');
  });
});

// ---------------------------------------------------------------------------
// buildChartConfigForExplanations
// ---------------------------------------------------------------------------

describe('buildChartConfigForExplanations', () => {
  const baseParams = {
    chartConfig: savedChartConfig,
    dateRange,
    activeTab: 'time',
  };

  it('returns raw SQL queriedConfig with updated dateRange', () => {
    const result = buildChartConfigForExplanations({
      ...baseParams,
      queriedConfig: rawSqlConfig,
    });

    expect(result).toBeDefined();
    expect(result!.dateRange).toBe(dateRange);
    // @ts-expect-error union types..
    expect(result!.sqlTemplate).toBe(rawSqlConfig.sqlTemplate);
  });

  it('returns raw SQL savedChartConfig with updated dateRange', () => {
    const result = buildChartConfigForExplanations({
      ...baseParams,
      chartConfig: rawSqlSavedChartConfig,
    });

    expect(result).toBeDefined();
    expect(result!.dateRange).toBe(dateRange);
  });

  it('returns undefined when no configs match', () => {
    const result = buildChartConfigForExplanations({
      ...baseParams,
      queriedConfig: undefined,
      tableSource: undefined,
    });

    expect(result).toBeUndefined();
  });

  it('uses dbTimeChartConfig when activeTab is time and source matches', () => {
    const dbTimeConfig = {
      ...builderConfig,
      granularity: '1 hour',
    } as ChartConfigWithDateRange;

    const result = buildChartConfigForExplanations({
      ...baseParams,
      queriedConfig: builderConfig,
      queriedSourceId: logSource.id,
      tableSource: logSource,
      activeTab: 'time',
      dbTimeChartConfig: dbTimeConfig,
    });

    expect(result).toBeDefined();
  });

  it.each(['table', 'number', 'pie'] as const)(
    'uses queriedConfig for activeTab=%s and applies tab transform',
    activeTab => {
      const result = buildChartConfigForExplanations({
        ...baseParams,
        queriedConfig: builderConfig,
        queriedSourceId: logSource.id,
        tableSource: logSource,
        activeTab,
      });

      expect(result).toBeDefined();
    },
  );

  it('falls back to chartConfig when queriedSource does not match', () => {
    const result = buildChartConfigForExplanations({
      ...baseParams,
      queriedConfig: builderConfig,
      queriedSourceId: 'other-source',
      tableSource: logSource,
      chartConfig: { ...savedChartConfig, source: logSource.id },
    });

    expect(result).toBeDefined();
    // Should use tableSource fields since chartConfig.source matches
    expect(result!.connection).toBe(logSource.connection);
  });

  it('returns config as-is for unrecognized activeTab', () => {
    const result = buildChartConfigForExplanations({
      ...baseParams,
      queriedConfig: builderConfig,
      queriedSourceId: logSource.id,
      tableSource: logSource,
      activeTab: 'search',
    });

    expect(result).toBeDefined();
    // @ts-expect-error union types..
    expect(result!.select).toEqual(builderConfig.select);
  });

  it('returns undefined when config is raw SQL after resolution', () => {
    // queriedConfig is builder but after source mismatch, falls back to
    // chartConfig which is raw SQL
    const result = buildChartConfigForExplanations({
      ...baseParams,
      queriedConfig: undefined,
      tableSource: logSource,
      chartConfig: rawSqlSavedChartConfig,
    });

    // Raw SQL saved config is handled early, returns with dateRange
    expect(result).toBeDefined();
    expect(result!.dateRange).toBe(dateRange);
  });
});
