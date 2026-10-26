import { SourceKind } from '@hyperdx/common-utils/dist/types';

import {
  defaultExploreGroupBy,
  formatGroupByFields,
  GroupBySource,
  parseGroupByFields,
  resolveExploreGroupBy,
} from '@/components/Explore/exploreGroupBy';

describe('defaultExploreGroupBy', () => {
  it('splits logs on severity', () => {
    expect(
      defaultExploreGroupBy({
        kind: SourceKind.Log,
        severityTextExpression: 'SeverityText',
      }),
    ).toBe('SeverityText');
  });

  it('splits traces on status code', () => {
    expect(
      defaultExploreGroupBy({
        kind: SourceKind.Trace,
        statusCodeExpression: 'StatusCode',
        serviceNameExpression: 'ServiceName',
      }),
    ).toBe('StatusCode');
  });

  it('falls back to service name for traces with no status code', () => {
    expect(
      defaultExploreGroupBy({
        kind: SourceKind.Trace,
        serviceNameExpression: 'ServiceName',
      }),
    ).toBe('ServiceName');
  });

  it('has no default for other source kinds', () => {
    expect(defaultExploreGroupBy({ kind: SourceKind.Metric })).toBeUndefined();
    expect(defaultExploreGroupBy(undefined)).toBeUndefined();
  });
});

describe('resolveExploreGroupBy', () => {
  const logs: GroupBySource = {
    kind: SourceKind.Log,
    severityTextExpression: 'SeverityText',
  };

  it('prefers the reader’s grouping over the source default', () => {
    expect(resolveExploreGroupBy('ServiceName', logs)).toBe('ServiceName');
  });

  it('hands back to the default when the grouping is cleared', () => {
    expect(resolveExploreGroupBy('', logs)).toBe('SeverityText');
    expect(resolveExploreGroupBy('   ', logs)).toBe('SeverityText');
  });

  it('trims, so trailing whitespace does not reach the query', () => {
    expect(resolveExploreGroupBy('  ServiceName  ', logs)).toBe('ServiceName');
  });

  it('resolves to nothing when neither side has an opinion', () => {
    expect(
      resolveExploreGroupBy('', { kind: SourceKind.Metric }),
    ).toBeUndefined();
  });

  it('passes several dimensions through untouched', () => {
    expect(
      resolveExploreGroupBy('ServiceName, StatusCode', {
        kind: SourceKind.Trace,
        statusCodeExpression: 'StatusCode',
      }),
    ).toBe('ServiceName, StatusCode');
  });
});

describe('parseGroupByFields', () => {
  it('reads a single dimension', () => {
    expect(parseGroupByFields('ServiceName')).toEqual(['ServiceName']);
  });

  it('reads several dimensions', () => {
    expect(parseGroupByFields('ServiceName, StatusCode')).toEqual([
      'ServiceName',
      'StatusCode',
    ]);
  });

  it('keeps a bracketed map key whole', () => {
    expect(
      parseGroupByFields("ResourceAttributes['host.name'], ServiceName"),
    ).toEqual(["ResourceAttributes['host.name']", 'ServiceName']);
  });

  it('keeps a comma inside a function call whole', () => {
    expect(parseGroupByFields('concat(a, b), ServiceName')).toEqual([
      'concat(a, b)',
      'ServiceName',
    ]);
  });

  it('is empty when nothing is grouped', () => {
    expect(parseGroupByFields('')).toEqual([]);
    expect(parseGroupByFields('   ')).toEqual([]);
  });

  it('round-trips an expression that contains a comma', () => {
    const value = 'concat(a, b), ServiceName';
    expect(formatGroupByFields(parseGroupByFields(value))).toBe(value);
  });
});
