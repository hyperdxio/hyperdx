import { DASHBOARD_VARIABLE_NAME_MAX_LENGTH } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import {
  mcpFiltersParam,
  mcpPatchDashboardSchema,
  mcpTilesParam,
} from '@/mcp/tools/dashboards/schemas';
import {
  getFilterVariableWarnings,
  getRawSqlMissingSourceError,
  getRawSqlTileMacroWarnings,
  getRawSqlTilesMissingRequiredSource,
  getTileVariableWarnings,
} from '@/mcp/tools/dashboards/validation';
import type {
  ExternalDashboardFilterWithId,
  ExternalDashboardTileWithId,
} from '@/utils/zod';

const connectionId = new mongoose.Types.ObjectId().toString();
const sourceId = new mongoose.Types.ObjectId().toString();

describe('metric tile schema', () => {
  it('accepts exponential histograms and defaults their value expression', () => {
    const parsed = mcpTilesParam.parse([
      {
        name: 'P95 Duration',
        config: {
          displayType: 'line',
          sourceId,
          select: [
            {
              aggFn: 'quantile',
              level: 0.95,
              metricType: 'exponential histogram',
              metricName: 'http.server.request.duration',
            },
          ],
        },
      },
    ]);

    const config = parsed[0].config;
    expect(config).toMatchObject({ displayType: 'line' });
    if (!('select' in config)) {
      throw new Error('Expected a builder tile');
    }
    expect(config.select[0]).toMatchObject({
      metricType: 'exponential histogram',
      valueExpression: 'Value',
    });
  });
});

function makeSqlTile(overrides: {
  name?: string;
  sqlTemplate: string;
  sourceId?: string;
  displayType?: string;
}): ExternalDashboardTileWithId {
  return {
    id: 'sql-tile',
    x: 0,
    y: 0,
    w: 12,
    h: 4,
    name: overrides.name ?? 'SQL Tile',
    config: {
      configType: 'sql',
      displayType: overrides.displayType ?? 'table',
      connectionId,
      sqlTemplate: overrides.sqlTemplate,
      ...(overrides.sourceId ? { sourceId: overrides.sourceId } : {}),
    },
  } as ExternalDashboardTileWithId;
}

describe('tile-level where rejection (builder tiles)', () => {
  const builderTypes = [
    { displayType: 'line' },
    { displayType: 'stacked_bar' },
    { displayType: 'table', extra: { groupBy: 'SpanName' } },
    { displayType: 'number' },
    { displayType: 'pie', extra: { groupBy: 'SpanName' } },
    { displayType: 'bar', extra: { groupBy: 'SpanName' } },
  ];

  const baseConfig = (displayType: string, extra: object) => ({
    displayType,
    sourceId,
    select: [{ aggFn: 'count', alias: 'Count' }],
    ...extra,
  });

  it.each(builderTypes)(
    'rejects a tile-level where on a $displayType tile with an actionable message',
    ({ displayType, extra = {} }) => {
      const result = mcpTilesParam.safeParse([
        {
          name: 'T',
          config: { ...baseConfig(displayType, extra), where: 'level:error' },
        },
      ]);
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = JSON.stringify(result.error.issues);
        expect(msg).toContain('no tile-level `where`');
        expect(msg).toContain('select');
      }
    },
  );

  it('rejects a tile-level whereLanguage on a builder tile', () => {
    const result = mcpTilesParam.safeParse([
      {
        name: 'T',
        config: {
          ...baseConfig('table', { groupBy: 'SpanName' }),
          whereLanguage: 'sql',
        },
      },
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects a tile-level where on the patch schema too', () => {
    const result = mcpPatchDashboardSchema.safeParse({
      dashboardId: new mongoose.Types.ObjectId().toString(),
      tileId: 'tile-1',
      tile: {
        config: {
          ...baseConfig('table', { groupBy: 'SpanName' }),
          where: 'level:error',
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it('still parses a builder tile with no tile-level where', () => {
    const result = mcpTilesParam.safeParse([
      { name: 'T', config: baseConfig('table', { groupBy: 'SpanName' }) },
    ]);
    expect(result.success).toBe(true);
  });

  it('still ACCEPTS a tile-level where on search / heatmap / event_patterns', () => {
    const search = mcpTilesParam.safeParse([
      {
        name: 'S',
        config: { displayType: 'search', sourceId, where: 'level:error' },
      },
    ]);
    expect(search.success).toBe(true);

    const heatmap = mcpTilesParam.safeParse([
      {
        name: 'H',
        config: {
          displayType: 'heatmap',
          sourceId,
          select: [{ valueExpression: 'Duration' }],
          where: 'level:error',
        },
      },
    ]);
    expect(heatmap.success).toBe(true);
  });
});

describe('getRawSqlTilesMissingRequiredSource', () => {
  it('flags a raw SQL tile that uses $__filters without a sourceId', () => {
    expect(
      getRawSqlTilesMissingRequiredSource([
        makeSqlTile({
          name: 'Errors by Service',
          sqlTemplate:
            'SELECT count() FROM otel_traces WHERE $__timeFilter(Timestamp) AND $__filters',
        }),
      ]),
    ).toEqual([{ tile: 'Errors by Service', macros: ['$__filters'] }]);
  });

  it('flags a raw SQL tile that uses $__sourceTable without a sourceId', () => {
    expect(
      getRawSqlTilesMissingRequiredSource([
        makeSqlTile({
          name: 'Span Count',
          sqlTemplate:
            'SELECT count() FROM $__sourceTable WHERE $__timeFilter(Timestamp)',
        }),
      ]),
    ).toEqual([{ tile: 'Span Count', macros: ['$__sourceTable'] }]);
  });

  it('reports every source-dependent macro used by a tile', () => {
    expect(
      getRawSqlTilesMissingRequiredSource([
        makeSqlTile({
          name: 'Both Macros',
          sqlTemplate:
            'SELECT count() FROM $__sourceTable WHERE $__timeFilter(Timestamp) AND $__filters',
        }),
      ]),
    ).toEqual([
      { tile: 'Both Macros', macros: ['$__filters', '$__sourceTable'] },
    ]);
  });

  it('does not flag a raw SQL tile that sets a sourceId', () => {
    expect(
      getRawSqlTilesMissingRequiredSource([
        makeSqlTile({
          sourceId,
          sqlTemplate:
            'SELECT count() FROM $__sourceTable WHERE $__timeFilter(Timestamp) AND $__filters',
        }),
      ]),
    ).toEqual([]);
  });

  it('does not flag a raw SQL tile that uses no source-dependent macro', () => {
    // A multi-table query that legitimately omits sourceId and references
    // neither $__filters nor $__sourceTable must not be rejected.
    expect(
      getRawSqlTilesMissingRequiredSource([
        makeSqlTile({
          sqlTemplate:
            'SELECT count() FROM otel_traces t JOIN otel_logs l ON t.TraceId = l.TraceId WHERE $__timeFilter(t.Timestamp) LIMIT 10',
        }),
      ]),
    ).toEqual([]);
  });

  it('falls back to a positional label when the tile has no name', () => {
    expect(
      getRawSqlTilesMissingRequiredSource([
        makeSqlTile({
          name: '',
          sqlTemplate: 'SELECT count() FROM otel_traces WHERE $__filters',
        }),
      ]),
    ).toEqual([{ tile: 'tile #1', macros: ['$__filters'] }]);
  });

  it('ignores builder (non-SQL) tiles entirely', () => {
    const builderTile = {
      id: 'builder',
      x: 0,
      y: 0,
      w: 12,
      h: 4,
      name: 'Line',
      config: {
        displayType: 'line',
        sourceId,
        select: [{ aggFn: 'count', valueExpression: '', where: '' }],
      },
    } as unknown as ExternalDashboardTileWithId;
    expect(getRawSqlTilesMissingRequiredSource([builderTile])).toEqual([]);
  });

  it('collects every offending tile across a mixed set', () => {
    expect(
      getRawSqlTilesMissingRequiredSource([
        makeSqlTile({ name: 'A', sqlTemplate: 'SELECT 1 WHERE $__filters' }),
        makeSqlTile({
          name: 'B',
          sourceId,
          sqlTemplate: 'SELECT 1 WHERE $__filters',
        }),
        makeSqlTile({
          name: 'C',
          sqlTemplate: 'SELECT 1 FROM $__sourceTable',
        }),
      ]),
    ).toEqual([
      { tile: 'A', macros: ['$__filters'] },
      { tile: 'C', macros: ['$__sourceTable'] },
    ]);
  });
});

describe('getRawSqlMissingSourceError', () => {
  it('returns null when all tiles are valid', () => {
    expect(
      getRawSqlMissingSourceError([
        makeSqlTile({ sqlTemplate: 'SELECT 1 LIMIT 1' }),
      ]),
    ).toBeNull();
  });

  it('builds a message naming the offending tiles and macros', () => {
    const message = getRawSqlMissingSourceError([
      makeSqlTile({
        name: 'Errors by Service',
        sqlTemplate: 'SELECT count() FROM otel_traces WHERE $__filters',
      }),
    ]);
    expect(message).toContain('sourceId');
    expect(message).toContain('$__filters');
    expect(message).toContain('$__sourceTable');
    expect(message).toContain('Errors by Service (uses $__filters)');
  });
});

describe('getRawSqlTileMacroHints', () => {
  it('flags a tile with no time-range macro', () => {
    const hints = getRawSqlTileMacroWarnings([
      makeSqlTile({
        name: 'Static Count',
        sqlTemplate: 'SELECT count() FROM otel_traces LIMIT 1',
      }),
    ]);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('Static Count');
    expect(hints[0]).toContain('$__timeFilter');
    expect(hints[0]).toContain('strongly recommended');
  });

  it('does not flag a table tile that uses all recommended macros', () => {
    expect(
      getRawSqlTileMacroWarnings([
        makeSqlTile({
          sourceId,
          sqlTemplate:
            'SELECT count() FROM $__sourceTable WHERE $__timeFilter(Timestamp) AND $__filters LIMIT 10',
        }),
      ]),
    ).toEqual([]);
  });

  it('accepts any time-range macro to satisfy the time-range check', () => {
    // $__fromTime / $__toTime are an acceptable substitute for $__timeFilter.
    expect(
      getRawSqlTileMacroWarnings([
        makeSqlTile({
          sourceId,
          sqlTemplate:
            'SELECT count() FROM $__sourceTable ' +
            'WHERE Timestamp >= $__fromTime AND Timestamp <= $__toTime AND $__filters LIMIT 10',
        }),
      ]),
    ).toEqual([]);
  });

  it('flags a time-series tile that omits an interval macro', () => {
    const hints = getRawSqlTileMacroWarnings([
      makeSqlTile({
        name: 'Requests Over Time',
        displayType: 'line',
        sourceId,
        sqlTemplate:
          'SELECT toStartOfMinute(Timestamp) AS ts, count() FROM $__sourceTable ' +
          'WHERE $__timeFilter(Timestamp) AND $__filters GROUP BY ts',
      }),
    ]);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('$__timeInterval');
  });

  it('does not flag an interval macro on non-time-series tiles', () => {
    // A table tile does not need $__timeInterval.
    expect(
      getRawSqlTileMacroWarnings([
        makeSqlTile({
          displayType: 'table',
          sourceId,
          sqlTemplate:
            'SELECT count() FROM $__sourceTable WHERE $__timeFilter(Timestamp) AND $__filters',
        }),
      ]),
    ).toEqual([]);
  });

  it('does not flag a time-series tile that includes an interval macro', () => {
    expect(
      getRawSqlTileMacroWarnings([
        makeSqlTile({
          displayType: 'stacked_bar',
          sourceId,
          sqlTemplate:
            'SELECT $__timeInterval(Timestamp) AS ts, count() FROM $__sourceTable ' +
            'WHERE $__timeFilter(Timestamp) AND $__filters GROUP BY ts',
        }),
      ]),
    ).toEqual([]);
  });

  it('flags missing $__filters and $__sourceTable when a sourceId is set', () => {
    const hints = getRawSqlTileMacroWarnings([
      makeSqlTile({
        name: 'Hardcoded Table',
        sourceId,
        sqlTemplate:
          'SELECT count() FROM otel_traces WHERE $__timeFilter(Timestamp)',
      }),
    ]);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('$__filters');
    expect(hints[0]).toContain('$__sourceTable');
  });

  it('still suggests $__filters / $__sourceTable even without a sourceId', () => {
    // The advisory always checks for these macros and notes that they require
    // a sourceId, so the agent can either add one or knowingly disregard it
    // (e.g. for a multi-table query that intentionally omits a source).
    const hints = getRawSqlTileMacroWarnings([
      makeSqlTile({
        sqlTemplate:
          'SELECT count() FROM otel_traces t JOIN otel_logs l ON t.TraceId = l.TraceId ' +
          'WHERE $__timeFilter(t.Timestamp) LIMIT 10',
      }),
    ]);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('$__filters');
    expect(hints[0]).toContain('$__sourceTable');
    expect(hints[0]).toContain('requires a sourceId');
  });

  it('ignores builder (non-SQL) tiles entirely', () => {
    const builderTile = {
      id: 'builder',
      x: 0,
      y: 0,
      w: 12,
      h: 4,
      name: 'Line',
      config: {
        displayType: 'line',
        sourceId,
        select: [{ aggFn: 'count', valueExpression: '', where: '' }],
      },
    } as unknown as ExternalDashboardTileWithId;
    expect(getRawSqlTileMacroWarnings([builderTile])).toEqual([]);
  });

  it('falls back to a positional label when the tile has no name', () => {
    const hints = getRawSqlTileMacroWarnings([
      makeSqlTile({ name: '', sqlTemplate: 'SELECT count() FROM otel_traces' }),
    ]);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('tile #1');
  });
});

// ─── Variable-enabled filters ────────────────────────────────────────────────

function makeFilter(
  overrides: Partial<ExternalDashboardFilterWithId> = {},
): ExternalDashboardFilterWithId {
  return {
    id: new mongoose.Types.ObjectId().toString(),
    type: 'QUERY_EXPRESSION',
    name: 'Service',
    expression: 'ServiceName',
    sourceId,
    whereLanguage: 'sql',
    ...overrides,
  };
}

function makeSearchTile(overrides: {
  name?: string;
  where: string;
  whereLanguage: 'sql' | 'lucene';
}): ExternalDashboardTileWithId {
  return {
    id: 'search-tile',
    x: 0,
    y: 0,
    w: 12,
    h: 4,
    name: overrides.name ?? 'Search Tile',
    config: {
      displayType: 'search',
      sourceId,
      select: '',
      where: overrides.where,
      whereLanguage: overrides.whereLanguage,
    },
  };
}

function makeSeriesTile(overrides: {
  name?: string;
  where: string;
  whereLanguage: 'sql' | 'lucene';
}): ExternalDashboardTileWithId {
  return {
    id: 'series-tile',
    x: 0,
    y: 0,
    w: 12,
    h: 4,
    name: overrides.name ?? 'Series Tile',
    config: {
      displayType: 'line',
      sourceId,
      select: [
        {
          aggFn: 'count',
          alias: 'Count',
          where: overrides.where,
          whereLanguage: overrides.whereLanguage,
        },
      ],
    },
  };
}

function makeTableTile(overrides: {
  name?: string;
  selectWhere: string;
  selectWhereLanguage: 'sql' | 'lucene';
  having?: string;
  groupBy?: string;
}): ExternalDashboardTileWithId {
  return {
    id: 'table-tile',
    x: 0,
    y: 0,
    w: 12,
    h: 4,
    name: overrides.name ?? 'Table Tile',
    config: {
      displayType: 'table',
      sourceId,
      select: [
        {
          aggFn: 'count',
          alias: 'Count',
          where: overrides.selectWhere,
          whereLanguage: overrides.selectWhereLanguage,
        },
      ],
      groupBy: overrides.groupBy,
      having: overrides.having,
    },
  };
}

describe('mcpFiltersParam variable fields', () => {
  it('preserves the variable fields so a filter round-trips', () => {
    const parsed = mcpFiltersParam.parse([
      {
        type: 'QUERY_EXPRESSION',
        name: 'Service Name',
        expression: 'ServiceName',
        sourceId,
        whereLanguage: 'sql',
        isBroadcastEnabled: false,
        isVariableEnabled: true,
        variableName: 'service',
      },
    ]);

    // The MCP schema used to omit these three, and a plain z.object silently
    // drops unknown keys, so reading a variable-enabled dashboard and saving
    // it back wiped the variable configuration.
    expect(parsed[0]).toMatchObject({
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      variableName: 'service',
    });
  });

  it.each([
    ['a space', 'has space'],
    ['a leading digit', '1service'],
    ['a leading underscore', '_service'],
    ['a dash', 'service-name'],
  ])('rejects a variableName with %s', (_label, variableName) => {
    const result = mcpFiltersParam.safeParse([
      {
        type: 'QUERY_EXPRESSION',
        name: 'Service',
        expression: 'ServiceName',
        sourceId,
        whereLanguage: 'sql',
        isVariableEnabled: true,
        variableName,
      },
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects a variableName over the length limit', () => {
    const result = mcpFiltersParam.safeParse([
      {
        type: 'QUERY_EXPRESSION',
        name: 'Service',
        expression: 'ServiceName',
        sourceId,
        whereLanguage: 'sql',
        isVariableEnabled: true,
        variableName: `v${'a'.repeat(DASHBOARD_VARIABLE_NAME_MAX_LENGTH)}`,
      },
    ]);
    expect(result.success).toBe(false);
  });

  it('accepts a filter that omits every variable field', () => {
    const parsed = mcpFiltersParam.parse([
      {
        type: 'QUERY_EXPRESSION',
        name: 'Service',
        expression: 'ServiceName',
        sourceId,
        whereLanguage: 'sql',
      },
    ]);
    expect(parsed[0].isVariableEnabled).toBeUndefined();
    expect(parsed[0].isBroadcastEnabled).toBeUndefined();
  });
});

describe('getTileVariableWarnings', () => {
  const variableFilter = makeFilter({
    isBroadcastEnabled: false,
    isVariableEnabled: true,
    variableName: 'service',
  });

  it('returns nothing for a tile that references no variable', () => {
    expect(
      getTileVariableWarnings(
        [
          makeSqlTile({
            sourceId,
            sqlTemplate: 'SELECT count() FROM $__sourceTable',
          }),
        ],
        [variableFilter],
      ),
    ).toEqual([]);
  });

  it('returns nothing for a raw SQL tile using $__filter on a declared variable', () => {
    expect(
      getTileVariableWarnings(
        [
          makeSqlTile({
            sourceId,
            sqlTemplate:
              'SELECT count() FROM $__sourceTable WHERE $__filter(ServiceName, $service)',
          }),
        ],
        [variableFilter],
      ),
    ).toEqual([]);
  });

  it('warns about an unguarded bare reference in raw SQL', () => {
    const warnings = getTileVariableWarnings(
      [
        makeSqlTile({
          name: 'Errors',
          sourceId,
          sqlTemplate:
            'SELECT count() FROM $__sourceTable WHERE ServiceName IN ($service)',
        }),
      ],
      [variableFilter],
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Tile "Errors"');
    expect(warnings[0]).toContain('renders as NULL');
  });

  it('warns about a reference wrapped in quotes', () => {
    const warnings = getTileVariableWarnings(
      [
        makeSqlTile({
          sourceId,
          sqlTemplate:
            "SELECT count() FROM $__sourceTable WHERE ServiceName = '$service'",
        }),
      ],
      [variableFilter],
    );
    expect(warnings.join('\n')).toContain('already quotes each value');
  });

  it('warns when a macro names a variable the dashboard does not declare', () => {
    const warnings = getTileVariableWarnings(
      [
        makeSqlTile({
          sourceId,
          sqlTemplate:
            'SELECT count() FROM $__sourceTable WHERE $__filter(ServiceName, $tenant)',
        }),
      ],
      [variableFilter],
    );
    expect(warnings.join('\n')).toContain('$__filter');
    expect(warnings.join('\n')).toContain("unknown variable 'tenant'");
    expect(warnings.join('\n')).toContain('Available variables: service');
  });

  it('warns about a variable macro in a Lucene builder input', () => {
    const warnings = getTileVariableWarnings(
      [
        makeSearchTile({
          name: 'Recent Errors',
          where: '$__filter(ServiceName, $service)',
          whereLanguage: 'lucene',
        }),
      ],
      [variableFilter],
    );
    expect(warnings.join('\n')).toContain('Lucene');
  });

  it('checks a builder tile per-series where', () => {
    const warnings = getTileVariableWarnings(
      [
        makeSeriesTile({
          name: 'Requests',
          where: 'ServiceName IN ($service)',
          whereLanguage: 'sql',
        }),
      ],
      [variableFilter],
    );
    expect(warnings.join('\n')).toContain('Tile "Requests"');
    expect(warnings.join('\n')).toContain('renders as NULL');
  });

  it("checks a select item's condition in its own language", () => {
    const warnings = getTileVariableWarnings(
      [
        makeSeriesTile({
          name: 'Requests',
          where: '$__filter(ServiceName, $service)',
          whereLanguage: 'lucene',
        }),
      ],
      [variableFilter],
    );
    expect(warnings.join('\n')).toContain('Tile "Requests"');
    expect(warnings.join('\n')).toContain('no meaning in a Lucene expression');
  });

  it('collects issues from every expression a builder tile walks', () => {
    const warnings = getTileVariableWarnings(
      [
        makeTableTile({
          name: 'Overview',
          selectWhere: 'ServiceName IN ($service)',
          selectWhereLanguage: 'sql',
          having: "count() > 0 AND ServiceName = '$service'",
          groupBy: '$service',
        }),
      ],
      [variableFilter],
    );
    expect(warnings).toHaveLength(3);
    expect(warnings.join('\n')).toContain('already quotes each value');
    expect(warnings.join('\n')).toContain('renders as NULL');
  });

  it('reports an unknown variable when the dashboard declares none', () => {
    const warnings = getTileVariableWarnings(
      [
        makeSqlTile({
          sourceId,
          sqlTemplate:
            'SELECT count() FROM $__sourceTable WHERE ServiceName IN ($service)',
        }),
      ],
      // A broadcast-only filter declares no variable.
      [makeFilter()],
    );
    expect(warnings.join('\n')).toContain('unknown variable');
    expect(warnings.join('\n')).toContain('(none)');
  });

  it('ignores markdown tiles, which have no expressions to check', () => {
    const markdownTile: ExternalDashboardTileWithId = {
      id: 'md',
      x: 0,
      y: 0,
      w: 12,
      h: 3,
      name: 'Notes',
      config: { displayType: 'markdown', markdown: 'Pick a $service' },
    };
    expect(getTileVariableWarnings([markdownTile], [variableFilter])).toEqual(
      [],
    );
  });
});

describe('getFilterVariableWarnings', () => {
  // The upstream filter of every dependent-filter case below.
  const serviceFilter = makeFilter({
    name: 'Service',
    expression: 'ServiceName',
    isVariableEnabled: true,
    variableName: 'service',
  });

  const endpointFilter = (
    overrides: Partial<ExternalDashboardFilterWithId> = {},
  ) =>
    makeFilter({
      name: 'Endpoint',
      expression: 'SpanName',
      ...overrides,
    });

  it('returns nothing when no filter carries a where', () => {
    expect(
      getFilterVariableWarnings([serviceFilter, endpointFilter()]),
    ).toEqual([]);
  });

  it('accepts a dependent filter guarded by $__filter', () => {
    expect(
      getFilterVariableWarnings([
        serviceFilter,
        endpointFilter({ where: '$__filter(ServiceName, $service)' }),
      ]),
    ).toEqual([]);
  });

  it('warns about a bare reference that leaves the dropdown empty', () => {
    const warnings = getFilterVariableWarnings([
      serviceFilter,
      endpointFilter({ where: 'ServiceName IN ($service)' }),
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Filter "Endpoint"');
    expect(warnings[0]).toContain('renders as NULL');
  });

  it('names the filter that must publish a referenced variable', () => {
    // "Service" collects the value but never exposes it, so $service does not
    // exist. The generic unknown-variable warning cannot say why; this one can.
    const warnings = getFilterVariableWarnings([
      makeFilter({ name: 'Service', expression: 'ServiceName' }),
      endpointFilter({ where: '$__filter(ServiceName, $service)' }),
    ]);
    const joined = warnings.join('\n');
    expect(joined).toContain('$service is not published as a variable');
    expect(joined).toContain('The filter named "Service"');
    expect(joined).toContain('isVariableEnabled: true');
  });

  it('warns when a filter references its own variable', () => {
    const warnings = getFilterVariableWarnings([
      serviceFilter,
      endpointFilter({
        isVariableEnabled: true,
        variableName: 'endpoint',
        where: '$__filter(SpanName, $endpoint)',
      }),
    ]);
    const joined = warnings.join('\n');
    expect(joined).toContain("references this filter's own variable $endpoint");
    expect(joined).toContain('values already selected');
  });

  it('warns about a variable macro in a Lucene dropdown query', () => {
    const warnings = getFilterVariableWarnings([
      serviceFilter,
      endpointFilter({
        where: '$__filter(ServiceName, $service)',
        whereLanguage: 'lucene',
      }),
    ]);
    expect(warnings.join('\n')).toContain('Lucene');
  });

  it('treats a missing whereLanguage as sql, matching the dropdown query', () => {
    // resolveFilterValuesWhere defaults to sql, so the macro resolves and
    // there is nothing to report. Defaulting to lucene here would produce a
    // bogus "no meaning in a Lucene expression" error on a working filter.
    const { whereLanguage: _dropped, ...withoutLanguage } = endpointFilter({
      where: '$__filter(ServiceName, $service)',
    });
    expect(getFilterVariableWarnings([serviceFilter, withoutLanguage])).toEqual(
      [],
    );
  });

  it('reports an unknown variable that no filter would own', () => {
    const warnings = getFilterVariableWarnings([
      serviceFilter,
      endpointFilter({ where: '$__filter(ServiceName, $tenant)' }),
    ]);
    const joined = warnings.join('\n');
    expect(joined).toContain('Filter "Endpoint"');
    expect(joined).toContain("unknown variable 'tenant'");
    expect(joined).toContain('Available variables: service');
  });
});
