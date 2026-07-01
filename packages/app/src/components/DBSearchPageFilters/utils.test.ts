import type { FilterState } from '@hyperdx/common-utils/dist/filters';

import {
  cleanClickHouseExpression,
  getFilterStateEntry,
  groupFacetsByBaseName,
  toClickHouseKeyExpression,
  toQuotedClickHouseKeyExpression,
} from './utils';

describe('cleanClickHouseExpression', () => {
  it('strips backticks from a bare quoted identifier', () => {
    expect(cleanClickHouseExpression('`service-name`')).toBe('service-name');
  });

  it('unwraps toString() and strips inner backticks', () => {
    expect(
      cleanClickHouseExpression('toString(ResourceAttributes.`hdx`.`sdk`)'),
    ).toBe('ResourceAttributes.hdx.sdk');
  });

  it('leaves a plain identifier unchanged', () => {
    expect(cleanClickHouseExpression('ServiceName')).toBe('ServiceName');
  });

  it('strips the quoted root of a bracket-form Map key', () => {
    expect(cleanClickHouseExpression("`my-map`['k']")).toBe("my-map['k']");
  });
});

describe('groupFacetsByBaseName — dot/bracket de-duplication', () => {
  it('collapses bracket-form and dot-form entries for the same logical key', () => {
    const result = groupFacetsByBaseName([
      { key: 'LogAttributes.time', value: ['1779461580003'] },
      {
        key: "LogAttributes['time']",
        value: ['1779461580003', '1779461580004'],
      },
    ]);

    expect(result.grouped).toHaveLength(1);
    expect(result.grouped[0].children).toHaveLength(1);
    const [child] = result.grouped[0].children;
    expect(child.propertyPath).toBe('time');
    // Bracket form wins so child.key stays valid as a ClickHouse expression
    expect(child.key).toBe("LogAttributes['time']");
    expect(child.value).toEqual(['1779461580003', '1779461580004']);
  });

  it('keeps the existing bracket-form key when a dot-form duplicate arrives second', () => {
    const result = groupFacetsByBaseName([
      { key: "LogAttributes['time']", value: ['a'] },
      { key: 'LogAttributes.time', value: ['b'] },
    ]);

    const [child] = result.grouped[0].children;
    expect(child.key).toBe("LogAttributes['time']");
    expect(child.value).toEqual(['a', 'b']);
  });

  it('merges values without duplicating identical entries', () => {
    const result = groupFacetsByBaseName([
      { key: 'LogAttributes.foo', value: ['x', 'y'] },
      { key: "LogAttributes['foo']", value: ['y', 'z'] },
    ]);

    expect(result.grouped[0].children[0].value).toEqual(['x', 'y', 'z']);
  });

  it('does not collapse different propertyPaths under the same base name', () => {
    const result = groupFacetsByBaseName([
      { key: "LogAttributes['time']", value: ['1'] },
      { key: "LogAttributes['user']", value: ['alice'] },
    ]);

    expect(result.grouped[0].children).toHaveLength(2);
  });
});

describe('getFilterStateEntry', () => {
  const makeEntry = (included: string[]): FilterState[string] => ({
    included: new Set<string | boolean>(included),
    excluded: new Set<string | boolean>(),
  });

  it('returns the entry for an exact key match', () => {
    const filterState: FilterState = {
      "LogAttributes['time']": makeEntry(['a']),
    };
    expect(getFilterStateEntry(filterState, "LogAttributes['time']")).toBe(
      filterState["LogAttributes['time']"],
    );
  });

  it('falls back to dot form when given bracket form', () => {
    const filterState: FilterState = {
      'LogAttributes.time': makeEntry(['1779461580003']),
    };
    const result = getFilterStateEntry(filterState, "LogAttributes['time']");
    expect(result).toBe(filterState['LogAttributes.time']);
  });

  it('falls back to bracket form when given dot form', () => {
    const filterState: FilterState = {
      "LogAttributes['time']": makeEntry(['1779461580003']),
    };
    const result = getFilterStateEntry(filterState, 'LogAttributes.time');
    expect(result).toBe(filterState["LogAttributes['time']"]);
  });

  it('returns undefined when no matching entry exists', () => {
    const filterState: FilterState = {
      OtherField: makeEntry(['x']),
    };
    expect(
      getFilterStateEntry(filterState, "LogAttributes['time']"),
    ).toBeUndefined();
  });

  it('returns undefined for non-map keys with no direct match', () => {
    const filterState: FilterState = {};
    expect(getFilterStateEntry(filterState, 'Timestamp')).toBeUndefined();
  });
});

describe('toClickHouseKeyExpression', () => {
  it('rewrites dot-form map sub-keys to bracket form', () => {
    expect(toClickHouseKeyExpression('LogAttributes.time')).toBe(
      "LogAttributes['time']",
    );
  });

  it('preserves the full property path when it contains dots', () => {
    expect(toClickHouseKeyExpression('ResourceAttributes.host.name')).toBe(
      "ResourceAttributes['host.name']",
    );
  });

  it('leaves bracket-form keys unchanged', () => {
    expect(toClickHouseKeyExpression("LogAttributes['time']")).toBe(
      "LogAttributes['time']",
    );
  });

  it('leaves double-quoted bracket-form keys unchanged', () => {
    expect(toClickHouseKeyExpression('LogAttributes["time"]')).toBe(
      'LogAttributes["time"]',
    );
  });

  it('leaves backtick-form JSON paths unchanged', () => {
    expect(toClickHouseKeyExpression('Body.`json`.`field`')).toBe(
      'Body.`json`.`field`',
    );
  });

  it('leaves toString() wrappers unchanged', () => {
    expect(
      toClickHouseKeyExpression("toString(LogAttributes['service.name'])"),
    ).toBe("toString(LogAttributes['service.name'])");
  });

  it('leaves plain column names unchanged', () => {
    expect(toClickHouseKeyExpression('Timestamp')).toBe('Timestamp');
  });

  // HDX-4369: parseMapFieldName proves the base is a Map, so a numeric-
  // looking sub-key must NOT collapse into array-index syntax. Without
  // mergePath's third argument the result was `LogAttributes[2]`, which
  // ClickHouse rejects with "Illegal types of arguments: Map(String,
  // String), UInt8 for function arrayElement" on the "Load more" path.
  it('rewrites a numeric-looking map sub-key to bracket form', () => {
    expect(toClickHouseKeyExpression('LogAttributes.1')).toBe(
      "LogAttributes['1']",
    );
  });

  it('preserves a multi-segment property path that starts with a numeric segment', () => {
    expect(toClickHouseKeyExpression('LogAttributes.42.foo')).toBe(
      "LogAttributes['42.foo']",
    );
  });

  // HDX-4427: "Add to Filters" on a value inside parsed JSON from a String
  // column builds a JSONExtract* function call as the filter key. These are
  // already valid ClickHouse expressions and must pass through untouched.
  // Previously the dot inside the quoted JSON path argument made
  // parseMapFieldName treat the whole expression as a dot-form Map sub-key, and
  // mergePath mangled it into invalid SQL like
  // `JSONExtractString(Body, 'app['user.currency')']`.
  describe('raw SQL function-call expression keys (parsed-JSON "Add to Filters")', () => {
    it.each([
      "JSONExtractString(Body, 'app.user.currency')",
      "JSONExtractString(Body, 'app', 'user.currency')",
      "JSONExtractString(Body, 'level')",
      "JSONExtractFloat(Body, 'metrics.latency')",
      "JSONExtractBool(Body, 'flags.enabled')",
      "JSONExtractString(LogAttributes['weird.key.payload'], 'abc.def.jqk/abcd')",
    ])('leaves the JSON-extract expression %s unchanged', key => {
      expect(toClickHouseKeyExpression(key)).toBe(key);
    });

    // The guard generalizes the previous `startsWith('toString(')` special case,
    // so a toString() wrapper with no bracket access still passes through.
    it('leaves a toString() wrapper without bracket access unchanged', () => {
      expect(toClickHouseKeyExpression('toString(Body)')).toBe(
        'toString(Body)',
      );
    });
  });
});

describe('toQuotedClickHouseKeyExpression', () => {
  const knownColumns = new Set([
    'ServiceName',
    'my column',
    'LogAttributes',
    'service-name',
    'my-map',
  ]);

  it('leaves a valid bare column unchanged', () => {
    expect(toQuotedClickHouseKeyExpression('ServiceName', knownColumns)).toBe(
      'ServiceName',
    );
  });

  it('quotes a column only when it needs it', () => {
    expect(toQuotedClickHouseKeyExpression('service-name', knownColumns)).toBe(
      '`service-name`',
    );
    expect(toQuotedClickHouseKeyExpression('my column', knownColumns)).toBe(
      '`my column`',
    );
  });

  it('converts a dot-form map sub-key to bracket form (valid root unquoted)', () => {
    expect(
      toQuotedClickHouseKeyExpression('LogAttributes.host', knownColumns),
    ).toBe("LogAttributes['host']");
  });

  it('quotes only the root of a bracket map access that needs it', () => {
    expect(toQuotedClickHouseKeyExpression("my-map['k']", knownColumns)).toBe(
      "`my-map`['k']",
    );
    expect(
      toQuotedClickHouseKeyExpression("LogAttributes['k']", knownColumns),
    ).toBe("LogAttributes['k']");
  });

  it('leaves already-backticked JSON path segments untouched, quoting only a bare root that needs it', () => {
    // Backtick-form JSON paths short-circuit toClickHouseKeyExpression, so they
    // reach the dotted-segment branch: already-quoted segments are preserved.
    expect(
      toQuotedClickHouseKeyExpression('Body.`json`.`field`', knownColumns),
    ).toBe('Body.`json`.`field`');
  });

  it('is idempotent on an already-quoted key', () => {
    expect(
      toQuotedClickHouseKeyExpression('`service-name`', knownColumns),
    ).toBe('`service-name`');
    expect(
      toQuotedClickHouseKeyExpression(
        toQuotedClickHouseKeyExpression('service-name', knownColumns),
        new Set(['service-name']),
      ),
    ).toBe('`service-name`');
  });

  // HDX-4427: the JSONExtract* key from a parsed-JSON "Add to Filters" reaches
  // toQuotedClickHouseKeyExpression via escapeFilterStateKeys. It is not a known
  // column and is already valid SQL, so it must pass through unquoted/unmangled.
  it('leaves a JSON-extract function-call key unchanged', () => {
    expect(
      toQuotedClickHouseKeyExpression(
        "JSONExtractString(Body, 'app.user.currency')",
        new Set(['Body']),
      ),
    ).toBe("JSONExtractString(Body, 'app.user.currency')");
  });

  describe('with knownColumns (schema-aware)', () => {
    it('quotes a flat column whose name contains dots as a single identifier', () => {
      const cols = new Set(['__hdx_materialized_k8s.cluster.name']);
      expect(
        toQuotedClickHouseKeyExpression(
          '__hdx_materialized_k8s.cluster.name',
          cols,
        ),
      ).toBe('`__hdx_materialized_k8s.cluster.name`');
    });

    it('leaves a valid flat column name unquoted', () => {
      const cols = new Set(['ServiceName']);
      expect(toQuotedClickHouseKeyExpression('ServiceName', cols)).toBe(
        'ServiceName',
      );
    });

    it('still treats a dotted key as Map access when it is NOT a known column', () => {
      const cols = new Set(['LogAttributes']);
      expect(toQuotedClickHouseKeyExpression('LogAttributes.host', cols)).toBe(
        "LogAttributes['host']",
      );
    });

    it('does not affect bracket-form map access for a known map column', () => {
      const cols = new Set(['LogAttributes']);
      expect(
        toQuotedClickHouseKeyExpression("LogAttributes['host']", cols),
      ).toBe("LogAttributes['host']");
    });

    it('does not affect bracket-form map access with a dot in the key', () => {
      const cols = new Set(['LogAttributes']);
      expect(
        toQuotedClickHouseKeyExpression("LogAttributes['host.name']", cols),
      ).toBe("LogAttributes['host.name']");
    });
  });
});
