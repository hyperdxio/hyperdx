import type { FilterState } from '@hyperdx/common-utils/dist/filters';

import {
  getFilterStateEntry,
  groupFacetsByBaseName,
  toClickHouseKeyExpression,
} from './utils';

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
});
