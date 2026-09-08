import {
  filterSelectionKey,
  getBlockingRequiredFilters,
  getUnsatisfiedRequiredFilters,
  parseDashboardFilterValues,
  resolveFilterSelection,
  serializeDashboardFilterValues,
} from '@/dashboardFilterValues';
import { FilterState, filtersToQuery } from '@/filters';
import type {
  DashboardFilter,
  DashboardFilterValue,
  PromqlLabelDashboardFilter,
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

const promqlFilter = (
  overrides: Partial<PromqlLabelDashboardFilter> = {},
): PromqlLabelDashboardFilter => ({
  id: 'f1',
  type: 'PROMETHEUS_LABEL',
  name: 'Pod',
  source: 'promql',
  label: 'pod',
  isBroadcastEnabled: false,
  isVariableEnabled: true,
  variableName: 'pod',
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

    it('keys a promql-label filter by its variable name', () => {
      expect(filterSelectionKey(promqlFilter())).toEqual({
        kind: 'variable',
        name: 'pod',
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

    it('resolves a promql-label filter from its variable entry', () => {
      const parsed = parseDashboardFilterValues([
        { type: 'variable', name: 'pod', values: ['api-0'] },
      ]);

      expect(resolveFilterSelection(promqlFilter(), parsed)).toEqual(
        included('api-0'),
      );
    });

    it.each([
      ['static-list', staticFilter()],
      ['promql-label', promqlFilter()],
    ])(
      'returns undefined for an expressionless %s filter with no variable entry',
      (_label, expressionless) => {
        const parsed = parseDashboardFilterValues([
          { type: 'sql', condition: "ServiceName IN ('legacy')" },
        ]);

        expect(resolveFilterSelection(expressionless, parsed)).toBeUndefined();
      },
    );

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

  describe('getUnsatisfiedRequiredFilters', () => {
    const required = (
      overrides: Partial<QueryExpressionDashboardFilter> = {},
    ) => filter({ minSelections: 1, ...overrides });

    it.each([
      ['no minimum', undefined],
      ['an explicit zero minimum', 0],
    ])('returns nothing for a filter with %s', (_label, minSelections) => {
      expect(
        getUnsatisfiedRequiredFilters(
          [filter({ minSelections }), staticFilter({ minSelections })],
          new Map(),
        ),
      ).toEqual([]);
    });

    // The scope is only ever read for a filter that is required, so a payload
    // carrying it alone must still leave the filter optional.
    it('returns nothing for a filter that is only scoped', () => {
      expect(
        getUnsatisfiedRequiredFilters(
          [filter({ isGlobalRequirement: true })],
          new Map(),
        ),
      ).toEqual([]);
    });

    it('returns nothing for a missing or empty filter list', () => {
      expect(getUnsatisfiedRequiredFilters(undefined, new Map())).toEqual([]);
      expect(getUnsatisfiedRequiredFilters([], new Map())).toEqual([]);
    });

    it('returns a required filter with no selection', () => {
      expect(getUnsatisfiedRequiredFilters([required()], new Map())).toEqual([
        required(),
      ]);
    });

    it('omits a required filter once a value is included', () => {
      expect(
        getUnsatisfiedRequiredFilters(
          [required()],
          new Map([['f1', included('api')]]),
        ),
      ).toEqual([]);
    });

    // A `NOT IN` narrows the data without choosing a value.
    it('still reports a filter whose selection only excludes', () => {
      expect(
        getUnsatisfiedRequiredFilters(
          [required()],
          new Map([
            [
              'f1',
              {
                included: new Set<string | boolean>(),
                excluded: new Set(['api']),
              },
            ],
          ]),
        ),
      ).toEqual([required()]);
    });

    it('preserves filter order and skips optional filters', () => {
      const filters = [
        required({ id: 'a', name: 'A' }),
        filter({ id: 'b', name: 'B' }),
        required({ id: 'c', name: 'C' }),
      ];

      expect(
        getUnsatisfiedRequiredFilters(filters, new Map()).map(f => f.name),
      ).toEqual(['A', 'C']);
    });
  });

  describe('getBlockingRequiredFilters', () => {
    const names = (
      filters: DashboardFilter[],
      tile: {
        sourceId?: string;
        referencedVariableNames?: string[];
        consumesBroadcastFilters?: boolean;
      },
    ) =>
      getBlockingRequiredFilters(filters, {
        consumesBroadcastFilters: true,
        ...tile,
      }).map(f => f.name);

    it('blocks any tile on a global requirement', () => {
      const filters = [
        filter({ minSelections: 1, isGlobalRequirement: true }),
        staticFilter({ minSelections: 1, isGlobalRequirement: true }),
      ];

      expect(
        names(filters, { sourceId: 'unrelated', referencedVariableNames: [] }),
      ).toEqual(['Service', 'Environment']);
      expect(names(filters, {})).toEqual(['Service', 'Environment']);
    });

    it('blocks only the tiles that reference the filter by default', () => {
      const filters = [staticFilter({ minSelections: 1 })];

      expect(
        names(filters, { sourceId: 'logs', referencedVariableNames: ['env'] }),
      ).toEqual(['Environment']);
      expect(
        names(filters, { sourceId: 'logs', referencedVariableNames: ['tier'] }),
      ).toEqual([]);
      expect(names(filters, {})).toEqual([]);
    });

    it('treats an explicit false the same as an absent flag', () => {
      const filters = [
        staticFilter({ minSelections: 1, isGlobalRequirement: false }),
      ];

      expect(names(filters, { referencedVariableNames: ['env'] })).toEqual([
        'Environment',
      ]);
      expect(names(filters, { referencedVariableNames: [] })).toEqual([]);
    });

    // A filter with no explicit variableName is still referenced by the token
    // derived from its display name.
    it('matches a filter by its derived variable name', () => {
      const filters = [
        staticFilter({ minSelections: 1, variableName: undefined }),
      ];

      expect(
        names(filters, { referencedVariableNames: ['Environment'] }),
      ).toEqual(['Environment']);
    });

    it('ignores a variable reference to a filter that publishes no variable', () => {
      const filters = [
        filter({
          minSelections: 1,
          isBroadcastEnabled: false,
          isVariableEnabled: false,
          variableName: 'svc',
        }),
      ];

      expect(names(filters, { referencedVariableNames: ['svc'] })).toEqual([]);
    });

    it('blocks a tile a broadcast reaches', () => {
      const unscoped = filter({ minSelections: 1 });
      const scoped = filter({
        minSelections: 1,
        appliesToSourceIds: ['logs'],
      });

      expect(names([unscoped], { sourceId: 'traces' })).toEqual(['Service']);
      expect(names([scoped], { sourceId: 'logs' })).toEqual(['Service']);
      expect(names([scoped], { sourceId: 'traces' })).toEqual([]);
      expect(names([scoped], {})).toEqual([]);
    });

    it('preserves filter order across the two scopes', () => {
      const filters = [
        staticFilter({
          id: 'a',
          name: 'A',
          variableName: 'a',
          minSelections: 1,
        }),
        filter({
          id: 'b',
          name: 'B',
          minSelections: 1,
          isGlobalRequirement: true,
        }),
        staticFilter({
          id: 'c',
          name: 'C',
          variableName: 'c',
          minSelections: 1,
        }),
      ];

      expect(names(filters, { referencedVariableNames: ['c', 'a'] })).toEqual([
        'A',
        'B',
        'C',
      ]);
    });

    // Both modes at once is what "Applies to sources" plus a variable looks
    // like, and either path on its own is enough to block.
    it('blocks through either path when a filter does both', () => {
      const filters = [
        filter({
          minSelections: 1,
          isVariableEnabled: true,
          variableName: 'svc',
          appliesToSourceIds: ['logs'],
        }),
      ];

      expect(names(filters, { sourceId: 'logs' })).toEqual(['Service']);
      expect(
        names(filters, {
          sourceId: 'traces',
          referencedVariableNames: ['svc'],
        }),
      ).toEqual(['Service']);
      expect(
        names(filters, {
          sourceId: 'traces',
          referencedVariableNames: ['other'],
        }),
      ).toEqual([]);
    });

    // A PromQL tile is handed no filters, and a raw-SQL tile can drop them, so
    // sharing a source with a broadcast does not mean the tile reads it.
    it('does not block on broadcast when the tile ignores broadcast filters', () => {
      const filters = [
        filter({ id: 'a', minSelections: 1 }),
        filter({
          id: 'b',
          name: 'Global',
          minSelections: 1,
          isGlobalRequirement: true,
        }),
        staticFilter({ id: 'c', minSelections: 1 }),
      ];

      expect(
        names(filters, {
          sourceId: 'logs',
          referencedVariableNames: ['env'],
          consumesBroadcastFilters: false,
        }),
      ).toEqual(['Global', 'Environment']);
    });

    it('returns nothing for an empty list', () => {
      expect(names([], { sourceId: 'logs' })).toEqual([]);
    });
  });
});
