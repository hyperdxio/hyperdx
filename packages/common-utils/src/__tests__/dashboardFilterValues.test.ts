import {
  filterSelectionKey,
  parseDashboardFilterValues,
  resolveFilterSelection,
  serializeDashboardFilterValues,
} from '@/dashboardFilterValues';
import { FilterState, filtersToQuery } from '@/filters';
import type {
  DashboardFilterValue,
  QueryExpressionDashboardFilter,
  StaticListDashboardFilter,
} from '@/types';

const filter = (
  overrides: Partial<QueryExpressionDashboardFilter> = {},
): QueryExpressionDashboardFilter => ({
  id: 'f1',
  type: 'QUERY_EXPRESSION',
  name: 'Service',
  expression: 'ServiceName',
  source: 'logs',
  ...overrides,
});

const staticFilter = (
  overrides: Partial<StaticListDashboardFilter> = {},
): StaticListDashboardFilter => ({
  id: 'f1',
  type: 'STATIC_LIST',
  name: 'Environment',
  options: ['prod', 'staging', 'dev'],
  isBroadcastEnabled: false,
  isVariableEnabled: true,
  variableName: 'env',
  ...overrides,
});

const included = (...values: (string | boolean)[]) => ({
  included: new Set(values),
  excluded: new Set<string | boolean>(),
});

describe('dashboardFilterValues', () => {
  describe('parseDashboardFilterValues', () => {
    it('returns empty buckets for a missing / empty array', () => {
      for (const input of [undefined, []]) {
        const parsed = parseDashboardFilterValues(input);
        expect(parsed.byExpression).toEqual({});
        expect(parsed.byVariable.size).toBe(0);
        expect(parsed.passthrough).toEqual([]);
      }
    });

    it('splits a mixed array into both addressing schemes', () => {
      const parsed = parseDashboardFilterValues([
        { type: 'sql', condition: "Env IN ('prod')" },
        { type: 'variable', name: 'svc', values: ['accounting'] },
      ]);

      expect(parsed.byExpression).toEqual({ Env: included('prod') });
      expect(Array.from(parsed.byVariable)).toEqual([['svc', ['accounting']]]);
      expect(parsed.passthrough).toEqual([]);
    });

    it('handles a variable-only array', () => {
      const parsed = parseDashboardFilterValues([
        { type: 'variable', name: 'svc', values: ['a', 'b'] },
        { type: 'variable', name: 'env', values: [] },
      ]);

      expect(parsed.byExpression).toEqual({});
      expect(Array.from(parsed.byVariable)).toEqual([
        ['svc', ['a', 'b']],
        ['env', []],
      ]);
    });

    it('handles a sql-only array, merging entries on one expression', () => {
      const parsed = parseDashboardFilterValues([
        { type: 'sql', condition: "ServiceName IN ('a')" },
        { type: 'sql', condition: "ServiceName NOT IN ('b')" },
      ]);

      expect(parsed.byExpression).toEqual({
        ServiceName: { included: new Set(['a']), excluded: new Set(['b']) },
      });
      expect(parsed.byVariable.size).toBe(0);
    });

    it('keeps the first of two entries claiming the same variable name', () => {
      const parsed = parseDashboardFilterValues([
        { type: 'variable', name: 'svc', values: ['first'] },
        { type: 'variable', name: 'svc', values: ['second'] },
      ]);

      expect(Array.from(parsed.byVariable)).toEqual([['svc', ['first']]]);
    });

    it('routes non-sql entries to passthrough', () => {
      const lucene: DashboardFilterValue = {
        type: 'lucene',
        condition: 'ServiceName:"api"',
      };
      const sqlAst: DashboardFilterValue = {
        type: 'sql_ast',
        operator: '=',
        left: 'ServiceName',
        right: 'api',
      };

      const parsed = parseDashboardFilterValues([
        lucene,
        sqlAst,
        { type: 'sql', condition: "Env IN ('prod')" },
      ]);

      expect(parsed.passthrough).toEqual([lucene, sqlAst]);
      expect(parsed.byExpression).toEqual({ Env: included('prod') });
    });

    it('drops a sql entry it can extract nothing from, rather than carrying it', () => {
      // Carrying these would grow the URL without bound: a rebuild re-emits
      // every declared filter through `filtersToQuery`, so a filter whose
      // expression cannot survive that round trip would append a fresh dead
      // copy on every write. `parseQuery` extracts nothing from the first
      // (top-level comparison operator, not an IN clause) or the second (empty).
      const parsed = parseDashboardFilterValues([
        { type: 'sql', condition: "ServiceName = 'api'" },
        { type: 'sql', condition: '  ' },
        { type: 'sql', condition: "Env IN ('prod')" },
      ]);

      expect(parsed.passthrough).toEqual([]);
      expect(parsed.byExpression).toEqual({ Env: included('prod') });
    });
  });

  describe('serializeDashboardFilterValues', () => {
    it('returns an empty array for empty input', () => {
      expect(serializeDashboardFilterValues({})).toEqual([]);
    });

    it('orders legacy entries, then variable entries, then passthrough', () => {
      const passthrough: DashboardFilterValue = {
        type: 'lucene',
        condition: 'Level:"error"',
      };

      expect(
        serializeDashboardFilterValues({
          byExpression: { Env: included('prod'), Region: included('us') },
          byVariable: new Map([
            ['svc', ['accounting']],
            ['team', ['platform']],
          ]),
          passthrough: [passthrough],
        }),
      ).toEqual([
        { type: 'sql', condition: "Env IN ('prod')" },
        { type: 'sql', condition: "Region IN ('us')" },
        { type: 'variable', name: 'svc', values: ['accounting'] },
        { type: 'variable', name: 'team', values: ['platform'] },
        passthrough,
      ]);
    });

    it('omits empty selections from both schemes', () => {
      expect(
        serializeDashboardFilterValues({
          byExpression: {
            Env: included(),
            Region: included('us'),
          },
          byVariable: new Map([
            ['svc', []],
            ['team', ['platform']],
          ]),
        }),
      ).toEqual([
        { type: 'sql', condition: "Region IN ('us')" },
        { type: 'variable', name: 'team', values: ['platform'] },
      ]);
    });

    it('emits legacy entries byte-identically to filtersToQuery', () => {
      const byExpression: FilterState = {
        ServiceName: {
          included: new Set(["it's", 'back\\slash', 'a,b']),
          excluded: new Set(['nope']),
        },
        Latency: {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>(),
          range: { min: 1, max: 2 },
        },
      };

      expect(serializeDashboardFilterValues({ byExpression })).toEqual(
        filtersToQuery(byExpression, { stringifyKeys: false }),
      );
    });
  });

  describe('round-tripping values', () => {
    // Values chosen to exercise SQL escaping, the comma splitter, the
    // date-expression unwrap, and boolean coercion on the legacy path.
    const AWKWARD_VALUES = [
      "it's",
      'back\\slash',
      "escaped\\'quote",
      'a,b',
      'close)paren',
      'open(paren',
      'toString(',
      "parseDateTime64BestEffort('x', 9)",
      'true',
      'TRUE',
      '',
      '   ',
      'ünïcødé 🎉',
      'x'.repeat(5000),
    ];

    it.each(AWKWARD_VALUES.map(v => [JSON.stringify(v), v]))(
      'preserves %s exactly on the variable path',
      (_label, value) => {
        const entries = serializeDashboardFilterValues({
          byVariable: new Map([['svc', [value]]]),
        });
        expect(entries).toEqual([
          { type: 'variable', name: 'svc', values: [value] },
        ]);

        // The URL carries the JSON encoding of the array, so assert the value
        // survives that too rather than only the in-memory hop.
        const parsed = parseDashboardFilterValues(
          JSON.parse(JSON.stringify(entries)),
        );
        expect(parsed.byVariable.get('svc')).toEqual([value]);
        expect(parsed.byExpression).toEqual({});
        expect(parsed.passthrough).toEqual([]);
      },
    );

    it.each(AWKWARD_VALUES.map(v => [JSON.stringify(v), v]))(
      'preserves %s on the legacy path too, when it wrote the SQL itself',
      (_label, value) => {
        // Every value the app emits is quoted and escaped by `filtersToQuery`,
        // and the parser reverses that exactly — including for `true` and for a
        // value shaped like a date wrapper. The legacy path's known lossiness is
        // confined to SQL text written by something *else* (see below), which
        // matters because that is the only kind the new format cannot express.
        const entries = serializeDashboardFilterValues({
          byExpression: { ServiceName: included(value) },
        });
        const parsed = parseDashboardFilterValues(
          JSON.parse(JSON.stringify(entries)),
        );
        expect(parsed.byExpression.ServiceName?.included).toEqual(
          new Set([value]),
        );
      },
    );

    // The differences between the two formats, asserted so the variable
    // format's divergence reads as intentional rather than accidental. Both
    // require a hand-written (or link-builder-written) legacy entry, since the
    // app's own writes are always quoted.
    it('documents an unquoted true in a legacy entry becoming a boolean', () => {
      const parsed = parseDashboardFilterValues([
        { type: 'sql', condition: 'ServiceName IN (true)' },
      ]);
      expect(parsed.byExpression.ServiceName.included).toEqual(new Set([true]));

      // Re-emitted unquoted, so `toString(ServiceName) IN (true)` is a type
      // error against a String column. The variable format has no coercion step
      // at all, so the same selection stays the string 'true'.
      expect(serializeDashboardFilterValues(parsed)).toEqual([
        { type: 'sql', condition: 'ServiceName IN (true)' },
      ]);
      expect(
        serializeDashboardFilterValues({
          byVariable: new Map([['svc', ['true']]]),
        }),
      ).toEqual([{ type: 'variable', name: 'svc', values: ['true'] }]);
    });

    it('documents a legacy date-column entry losing its value wrapper', () => {
      // The unwrap exists so a date column's condition parses back to the plain
      // literal; a caller that wrote the wrapper itself does not get it back.
      const parsed = parseDashboardFilterValues([
        {
          type: 'sql',
          condition: "Timestamp IN (parseDateTime64BestEffort('x', 9))",
        },
      ]);
      expect(parsed.byExpression.Timestamp.included).toEqual(new Set(['x']));
      expect(serializeDashboardFilterValues(parsed)).toEqual([
        { type: 'sql', condition: "Timestamp IN ('x')" },
      ]);
    });
  });

  describe('filterSelectionKey', () => {
    it('keys a variable-enabled filter by its variable name', () => {
      expect(
        filterSelectionKey(
          filter({ isVariableEnabled: true, variableName: 'svc' }),
        ),
      ).toEqual({ kind: 'variable', name: 'svc' });
    });

    it('keys a filter with no variable by its expression', () => {
      expect(filterSelectionKey(filter())).toEqual({
        kind: 'expression',
        expression: 'ServiceName',
      });
      expect(filterSelectionKey(filter({ isVariableEnabled: false }))).toEqual({
        kind: 'expression',
        expression: 'ServiceName',
      });
    });

    it('falls back to the name derived from the display name', () => {
      expect(
        filterSelectionKey(
          filter({
            name: 'Total Requests',
            isVariableEnabled: true,
            variableName: '   ',
          }),
        ),
      ).toEqual({ kind: 'variable', name: 'Total_Requests' });
    });

    it('keys by expression when nothing usable can be derived', () => {
      expect(
        filterSelectionKey(filter({ name: '环境', isVariableEnabled: true })),
      ).toEqual({ kind: 'expression', expression: 'ServiceName' });
    });

    it('keys a static-list filter by its variable name', () => {
      expect(filterSelectionKey(staticFilter())).toEqual({
        kind: 'variable',
        name: 'env',
      });
    });

    // Unreachable through the write paths — a static filter is variable-only by
    // construction — but it has no expression to fall back to, so the key stays
    // variable-kind even when no name can be derived from it.
    it('keys a static-list filter by variable even when no name can be derived', () => {
      expect(
        filterSelectionKey(staticFilter({ name: '环境', variableName: '' })),
      ).toEqual({ kind: 'variable', name: '' });
    });
  });

  describe('resolveFilterSelection', () => {
    const variableFilter = filter({
      isVariableEnabled: true,
      variableName: 'svc',
    });

    it('prefers a variable entry over a legacy one for the same filter', () => {
      const parsed = parseDashboardFilterValues([
        { type: 'sql', condition: "ServiceName IN ('legacy')" },
        { type: 'variable', name: 'svc', values: ['new'] },
      ]);

      expect(resolveFilterSelection(variableFilter, parsed)).toEqual(
        included('new'),
      );
    });

    it('treats an explicitly empty variable entry as a selection', () => {
      const parsed = parseDashboardFilterValues([
        { type: 'sql', condition: "ServiceName IN ('legacy')" },
        { type: 'variable', name: 'svc', values: [] },
      ]);

      expect(resolveFilterSelection(variableFilter, parsed)).toEqual(
        included(),
      );
    });

    it('falls back to the expression entry for back-compat', () => {
      const parsed = parseDashboardFilterValues([
        { type: 'sql', condition: "ServiceName IN ('legacy')" },
      ]);

      expect(resolveFilterSelection(variableFilter, parsed)).toEqual(
        included('legacy'),
      );
    });

    it('reads a non-variable filter by expression only', () => {
      const parsed = parseDashboardFilterValues([
        { type: 'variable', name: 'svc', values: ['new'] },
        { type: 'sql', condition: "ServiceName IN ('legacy')" },
      ]);

      expect(resolveFilterSelection(filter(), parsed)).toEqual(
        included('legacy'),
      );
    });

    it('returns undefined when nothing addresses the filter', () => {
      const parsed = parseDashboardFilterValues([
        { type: 'variable', name: 'other', values: ['x'] },
        { type: 'sql', condition: "Env IN ('prod')" },
      ]);

      expect(resolveFilterSelection(variableFilter, parsed)).toBeUndefined();
      expect(resolveFilterSelection(filter(), parsed)).toBeUndefined();
    });

    it('resolves a static-list filter from its variable entry', () => {
      const parsed = parseDashboardFilterValues([
        { type: 'variable', name: 'env', values: ['prod'] },
      ]);

      expect(resolveFilterSelection(staticFilter(), parsed)).toEqual(
        included('prod'),
      );
    });

    it('returns undefined for an expressionless filter with no variable entry', () => {
      const parsed = parseDashboardFilterValues([
        { type: 'sql', condition: "ServiceName IN ('legacy')" },
      ]);

      expect(resolveFilterSelection(staticFilter(), parsed)).toBeUndefined();
    });

    it('resolves two filters sharing an expression independently', () => {
      const parsed = parseDashboardFilterValues([
        { type: 'sql', condition: "ServiceName IN ('plain')" },
        { type: 'variable', name: 'svc', values: ['variable'] },
      ]);

      expect(resolveFilterSelection(variableFilter, parsed)).toEqual(
        included('variable'),
      );
      expect(resolveFilterSelection(filter({ id: 'f2' }), parsed)).toEqual(
        included('plain'),
      );
    });
  });
});
