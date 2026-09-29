import { renderHook } from '@testing-library/react';

import {
  mapHighlightTermsToColumns,
  useQueryHighlightTerms,
} from '@/hooks/useQueryHighlightTerms';

describe('mapHighlightTermsToColumns', () => {
  const columns = ['Timestamp', 'ServiceName', 'SeverityText', 'Body'];

  it('spreads bare terms across every column', () => {
    expect(mapHighlightTermsToColumns(['timeout'], columns)).toEqual({
      Timestamp: ['timeout'],
      ServiceName: ['timeout'],
      SeverityText: ['timeout'],
      Body: ['timeout'],
    });
  });

  it('keeps field-scoped terms in their own column', () => {
    expect(
      mapHighlightTermsToColumns(['SeverityText:error oops'], columns),
    ).toEqual({
      Timestamp: ['oops'],
      ServiceName: ['oops'],
      SeverityText: ['error', 'oops'],
      Body: ['oops'],
    });
  });

  it('drops field-scoped terms whose column is not displayed', () => {
    expect(mapHighlightTermsToColumns(['TraceId:abc123'], columns)).toEqual({});
  });

  it('matches map subscripts against their dotted field name', () => {
    expect(
      mapHighlightTermsToColumns(
        ['ResourceAttributes.host.name:web-1'],
        ["ResourceAttributes['host.name']"],
      ),
    ).toEqual({ "ResourceAttributes['host.name']": ['web-1'] });
  });

  it('merges terms from several conditions without duplicating', () => {
    expect(
      mapHighlightTermsToColumns(
        ['timeout', 'ServiceName:checkout', 'timeout'],
        ['ServiceName', 'Body'],
      ),
    ).toEqual({
      ServiceName: ['timeout', 'checkout'],
      Body: ['timeout'],
    });
  });

  it('returns nothing for a query with no highlightable terms', () => {
    expect(mapHighlightTermsToColumns(['NOT timeout'], columns)).toEqual({});
    expect(mapHighlightTermsToColumns([], columns)).toEqual({});
  });
});

describe('useQueryHighlightTerms', () => {
  const displayedColumns = ['ServiceName', 'Body'];

  it('ignores a SQL where clause', () => {
    const { result } = renderHook(() =>
      useQueryHighlightTerms({
        where: "Body LIKE '%timeout%'",
        whereLanguage: 'sql',
        displayedColumns,
      }),
    );
    expect(result.current).toEqual({});
  });

  it('collects terms from the query and its Lucene filters', () => {
    const { result } = renderHook(() =>
      useQueryHighlightTerms({
        where: 'timeout',
        whereLanguage: 'lucene',
        filters: [
          { type: 'lucene', condition: 'ServiceName:"checkout"' },
          { type: 'sql', condition: "Body LIKE '%nope%'" },
        ],
        displayedColumns,
      }),
    );
    expect(result.current).toEqual({
      ServiceName: ['timeout', 'checkout'],
      Body: ['timeout'],
    });
  });

  it('returns a stable object across re-renders', () => {
    const { result, rerender } = renderHook(() =>
      useQueryHighlightTerms({
        where: 'timeout',
        whereLanguage: 'lucene',
        displayedColumns,
      }),
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
