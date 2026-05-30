import type { DashboardFilter, Filter } from '@hyperdx/common-utils/dist/types';

import {
  buildConstantExpressionSet,
  mergeConstantFiltersForSave,
  normalizeExpression,
  removeSavedDefaultForExpression,
  stripConstantsFromUrl,
  upsertSavedDefault,
} from '../dashboardFilterUtils';

// Small helpers: filter definitions used across cases.
const constantFilter = (
  expression: string,
  overrides: Partial<DashboardFilter> = {},
): DashboardFilter => ({
  id: `filter-${expression}`,
  type: 'QUERY_EXPRESSION',
  name: expression,
  expression,
  source: 'logs',
  constant: true,
  ...overrides,
});

const editableFilter = (
  expression: string,
  overrides: Partial<DashboardFilter> = {},
): DashboardFilter => ({
  id: `filter-${expression}`,
  type: 'QUERY_EXPRESSION',
  name: expression,
  expression,
  source: 'logs',
  ...overrides,
});

describe('normalizeExpression', () => {
  it('normalizes bracket-notation expressions to dot-notation', () => {
    expect(normalizeExpression("SpanAttributes['k8s.pod.name']")).toBe(
      'SpanAttributes.k8s.pod.name',
    );
  });

  it('leaves dot-notation expressions unchanged', () => {
    expect(normalizeExpression('SpanAttributes.k8s.pod.name')).toBe(
      'SpanAttributes.k8s.pod.name',
    );
  });

  it('normalizes simple identifiers', () => {
    expect(normalizeExpression('ServiceName')).toBe('ServiceName');
  });
});

describe('buildConstantExpressionSet', () => {
  it('returns an empty set when no filters are constant', () => {
    expect(
      buildConstantExpressionSet([
        editableFilter('ServiceName'),
        editableFilter('SpanName'),
      ]),
    ).toEqual(new Set());
  });

  it('returns normalized expressions for constant filters', () => {
    expect(
      buildConstantExpressionSet([
        editableFilter('SpanName'),
        constantFilter('ServiceName'),
        constantFilter("SpanAttributes['k8s.pod.name']"),
      ]),
    ).toEqual(new Set(['ServiceName', 'SpanAttributes.k8s.pod.name']));
  });

  it('handles null / undefined input', () => {
    expect(buildConstantExpressionSet(undefined)).toEqual(new Set());
    expect(buildConstantExpressionSet(null)).toEqual(new Set());
    expect(buildConstantExpressionSet([])).toEqual(new Set());
  });
});

describe('stripConstantsFromUrl', () => {
  const luceneFilter = (condition: string): Filter => ({
    type: 'lucene',
    condition,
  });

  it('returns the input unchanged when no expressions are constant', () => {
    const input = [
      luceneFilter('ServiceName:"api"'),
      luceneFilter('SpanName:"GET /v1"'),
    ];
    expect(stripConstantsFromUrl(input, new Set())).toEqual(input);
  });

  it('removes entries whose expression is in the constant set', () => {
    const input = [
      luceneFilter('ServiceName:"api"'),
      luceneFilter('SpanName:"GET /v1"'),
    ];
    const result = stripConstantsFromUrl(input, new Set(['ServiceName']));
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    const cond = result![0];
    expect('condition' in cond ? cond.condition : '').toContain('SpanName');
  });

  it('matches bracket-notation expressions against dot-notation keys', () => {
    const input = [
      luceneFilter('SpanAttributes.k8s.pod.name:"pod-1"'),
      luceneFilter('ServiceName:"api"'),
    ];
    const result = stripConstantsFromUrl(
      input,
      new Set(['SpanAttributes.k8s.pod.name']),
    );
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    const cond = result![0];
    expect('condition' in cond ? cond.condition : '').toContain('ServiceName');
  });

  it('returns null when stripping leaves nothing', () => {
    const input = [luceneFilter('ServiceName:"api"')];
    const result = stripConstantsFromUrl(input, new Set(['ServiceName']));
    expect(result).toBeNull();
  });
});

describe('mergeConstantFiltersForSave', () => {
  const lucene = (condition: string): Filter => ({
    type: 'lucene',
    condition,
  });

  it('returns the URL state unchanged when there are no constants', () => {
    const url = [lucene('SpanName:"GET /v1"')];
    expect(mergeConstantFiltersForSave([], url, new Set())).toEqual(url);
  });

  it('preserves constant entries from savedFilterValues and drops URL collisions', () => {
    const constants = new Set(['ServiceName']);
    const saved = [lucene('ServiceName:"locked"')];
    // URL contains a stale ServiceName plus a normal SpanName entry.
    const url = [
      lucene('ServiceName:"stale-from-share-link"'),
      lucene('SpanName:"GET /v1"'),
    ];
    const result = mergeConstantFiltersForSave(saved, url, constants);
    expect(result).toHaveLength(2);
    const conditions = result.map(r => ('condition' in r ? r.condition : ''));
    // Locked value preserved, stale URL value dropped, sibling kept.
    expect(conditions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('locked'),
        expect.stringContaining('SpanName'),
      ]),
    );
    expect(conditions.every(c => !c.includes('stale-from-share-link'))).toBe(
      true,
    );
  });

  it('handles missing savedFilterValues (constant declared without saved value)', () => {
    const constants = new Set(['ServiceName']);
    const url = [lucene('SpanName:"GET /v1"')];
    const result = mergeConstantFiltersForSave(undefined, url, constants);
    expect(result).toHaveLength(1);
    expect('condition' in result[0] ? result[0].condition : '').toContain(
      'SpanName',
    );
  });
});

describe('upsertSavedDefault', () => {
  it('inserts a new saved value when none exists for the expression', () => {
    const result = upsertSavedDefault([], 'ServiceName', ['api']);
    expect(result).toHaveLength(1);
    const cond = 'condition' in result[0] ? result[0].condition : '';
    expect(cond).toContain('ServiceName');
    expect(cond).toContain('api');
  });

  it('replaces an existing saved value for the same expression', () => {
    const existing: Filter[] = [
      { type: 'lucene', condition: 'ServiceName:"old"' },
    ];
    const result = upsertSavedDefault(existing, 'ServiceName', ['new']);
    expect(result).toHaveLength(1);
    const cond = 'condition' in result[0] ? result[0].condition : '';
    expect(cond).toContain('new');
    expect(cond).not.toContain('old');
  });

  it('removes the entry when called with an empty values array', () => {
    const existing: Filter[] = [
      { type: 'lucene', condition: 'ServiceName:"api"' },
      { type: 'lucene', condition: 'SpanName:"GET /v1"' },
    ];
    const result = upsertSavedDefault(existing, 'ServiceName', []);
    expect(result).toHaveLength(1);
    const cond = 'condition' in result[0] ? result[0].condition : '';
    expect(cond).toContain('SpanName');
  });

  it('matches bracket-notation against dot-notation entries', () => {
    const existing: Filter[] = [
      {
        type: 'lucene',
        condition: 'SpanAttributes.k8s.pod.name:"old-pod"',
      },
    ];
    const result = upsertSavedDefault(
      existing,
      "SpanAttributes['k8s.pod.name']",
      ['new-pod'],
    );
    expect(result).toHaveLength(1);
    const cond = 'condition' in result[0] ? result[0].condition : '';
    expect(cond).toContain('new-pod');
    expect(cond).not.toContain('old-pod');
  });
});

describe('removeSavedDefaultForExpression', () => {
  it('returns undefined when input is undefined / empty', () => {
    expect(removeSavedDefaultForExpression(undefined, 'ServiceName')).toBe(
      undefined,
    );
    expect(removeSavedDefaultForExpression([], 'ServiceName')).toEqual([]);
  });

  it('strips entries matching the normalized expression', () => {
    const existing: Filter[] = [
      { type: 'lucene', condition: 'ServiceName:"api"' },
      { type: 'lucene', condition: 'SpanName:"GET /v1"' },
    ];
    const result = removeSavedDefaultForExpression(existing, 'ServiceName');
    expect(result).toHaveLength(1);
    const cond = result && 'condition' in result[0] ? result[0].condition : '';
    expect(cond).toContain('SpanName');
  });

  it('matches bracket-notation expressions', () => {
    const existing: Filter[] = [
      {
        type: 'lucene',
        condition: 'SpanAttributes.k8s.pod.name:"pod-1"',
      },
    ];
    const result = removeSavedDefaultForExpression(
      existing,
      "SpanAttributes['k8s.pod.name']",
    );
    expect(result).toEqual([]);
  });
});
