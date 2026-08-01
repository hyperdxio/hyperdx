import mongoose from 'mongoose';

import { mcpTilesParam } from '@/mcp/tools/dashboards/schemas';
import {
  getRawSqlMissingSourceError,
  getRawSqlTileMacroWarnings,
  getRawSqlTilesMissingRequiredSource,
} from '@/mcp/tools/dashboards/validation';
import type { ExternalDashboardTileWithId } from '@/utils/zod';

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
