import {
  type FilterState,
  filtersToQuery,
  isValidFilterCondition,
} from '@hyperdx/common-utils/dist/filters';

import { buildJSONExtractQuery } from '@/components/DBRowJsonViewer';
import { escapeFilterStateKeys, parseQuery } from '@/searchFilters';

import { cleanClickHouseExpression } from './utils';

// End-to-end coverage for the "Add to Filters" -> WHERE-clause path, driven
// through the real producer (buildJSONExtractQuery) and the real serialization
// (escapeFilterStateKeys -> filtersToQuery). This is the regression net for
// HDX-4427: a filter key that is a raw ClickHouse expression must serialize to
// valid SQL and survive a parseQuery round-trip. Asserting validity (rather
// than an exact string) catches this bug class for any JSON/Map key shape, not
// just the one the user happened to hit.

// Real top-level columns on a typical OTel logs table.
const knownColumns = new Set(['Body', 'LogAttributes', 'ServiceName']);

// buildJSONExtractQuery returns string | null; in every case here a nested path
// exists, so null is a test-setup error rather than an expected branch.
const jsonKey = (
  keyPath: string[],
  parsedJsonRootPath: string[],
  jsonColumns: string[] = [],
  jsonExtractFn:
    | 'JSONExtractString'
    | 'JSONExtractFloat'
    | 'JSONExtractBool' = 'JSONExtractString',
  mapColumns: string[] = [],
): string => {
  const out = buildJSONExtractQuery(
    keyPath,
    parsedJsonRootPath,
    jsonColumns,
    jsonExtractFn,
    mapColumns,
  );
  if (out == null) {
    throw new Error('buildJSONExtractQuery returned null for a nested path');
  }
  return out;
};

const runAddToFilter = (
  key: string,
  values: { included?: string[]; excluded?: string[] },
) => {
  const state: FilterState = {
    [key]: {
      included: new Set<string | boolean>(values.included ?? []),
      excluded: new Set<string | boolean>(values.excluded ?? []),
    },
  };
  // Mirror updateFilterQuery: escape keys, then serialize to the query.
  return filtersToQuery(escapeFilterStateKeys(state, knownColumns));
};

describe('parsed-JSON "Add to Filters" -> valid SQL pipeline (HDX-4427)', () => {
  const cases: {
    desc: string;
    key: string;
    values: { included?: string[]; excluded?: string[] };
  }[] = [
    {
      desc: 'flat dotted key in a String column (the reported play-clickstack case)',
      key: jsonKey(['Body', 'app.user.currency'], ['Body']),
      values: { included: ['USD'] },
    },
    {
      desc: 'nested path in a String column',
      key: jsonKey(['Body', 'app', 'user', 'id'], ['Body']),
      values: { included: ['u-1'] },
    },
    {
      desc: 'simple top-level key in a String column',
      key: jsonKey(['Body', 'level'], ['Body']),
      values: { included: ['error'], excluded: ['debug'] },
    },
    {
      desc: 'numeric metric via JSONExtractFloat with a dotted path',
      key: jsonKey(
        ['Body', 'metrics.latency'],
        ['Body'],
        [],
        'JSONExtractFloat',
      ),
      values: { included: ['200'] },
    },
    {
      desc: 'boolean flag via JSONExtractBool with a dotted path',
      key: jsonKey(['Body', 'flags.enabled'], ['Body'], [], 'JSONExtractBool'),
      values: { included: ['true'] },
    },
    {
      desc: 'Map sub-value holding JSON (bracketed base column)',
      key: jsonKey(
        ['LogAttributes', 'config', 'db.host'],
        ['LogAttributes', 'config'],
        [],
        'JSONExtractString',
        ['LogAttributes'],
      ),
      values: { included: ['localhost'] },
    },
    {
      desc: 'value containing a single quote (SQL escaping)',
      key: jsonKey(['Body', 'user.name'], ['Body']),
      values: { included: ["O'Brien"] },
    },
  ];

  it.each(cases)(
    'emits only valid ClickHouse SQL for $desc',
    ({ key, values }) => {
      const query = runAddToFilter(key, values);

      expect(query.length).toBeGreaterThan(0);
      for (const filter of query) {
        expect(filter.type).toBe('sql');
        if (filter.type === 'sql') {
          expect(isValidFilterCondition(filter.condition, 'sql')).toBe(true);
        }
      }
    },
  );

  it('emits the corrected, valid condition for the reported case', () => {
    const key = jsonKey(['Body', 'app.user.currency'], ['Body']);
    expect(runAddToFilter(key, { included: ['USD'] })).toEqual([
      {
        type: 'sql',
        condition: "JSONExtractString(Body, 'app.user.currency') IN ('USD')",
      },
    ]);
  });

  it('round-trips included and excluded values through parseQuery', () => {
    const key = jsonKey(['Body', 'app.user.currency'], ['Body']);
    const query = runAddToFilter(key, {
      included: ['USD', 'EUR'],
      excluded: ['JPY'],
    });

    const back = parseQuery(query).filters;
    // parseQuery keys are the canonical (escaped) form; clean them the same way
    // unescapeFilterStateKeys does before comparing to the in-memory key.
    const restoredKeys = Object.keys(back).map(cleanClickHouseExpression);
    expect(restoredKeys).toEqual([key]);

    const entry = back[Object.keys(back)[0]];
    expect(entry.included).toEqual(new Set(['USD', 'EUR']));
    expect(entry.excluded).toEqual(new Set(['JPY']));
  });

  it('round-trips a value containing a single quote', () => {
    const key = jsonKey(['Body', 'user.name'], ['Body']);
    const back = parseQuery(
      runAddToFilter(key, { included: ["O'Brien"] }),
    ).filters;
    const entry = back[Object.keys(back)[0]];
    expect(entry.included).toEqual(new Set(["O'Brien"]));
  });
});
