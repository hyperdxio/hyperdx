import mongoose from 'mongoose';

import type { ExternalDashboardTileWithId } from '@/utils/zod';

import {
  getRawSqlMissingSourceError,
  getRawSqlTilesMissingRequiredSource,
} from '../../tools/dashboards/validation';

const connectionId = new mongoose.Types.ObjectId().toString();
const sourceId = new mongoose.Types.ObjectId().toString();

function makeSqlTile(overrides: {
  name?: string;
  sqlTemplate: string;
  sourceId?: string;
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
      displayType: 'table',
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
