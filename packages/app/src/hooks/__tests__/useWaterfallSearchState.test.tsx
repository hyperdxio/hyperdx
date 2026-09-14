import { renderHook } from '@testing-library/react';

const mockSetters: Record<string, jest.Mock> = {};
function setterFor(key: string) {
  if (!mockSetters[key]) mockSetters[key] = jest.fn();
  return mockSetters[key];
}

jest.mock('nuqs', () => {
  const actual = jest.requireActual('nuqs');
  return {
    ...actual,
    useQueryState: (key: string) => {
      if (!mockSetters[key]) mockSetters[key] = jest.fn();
      return [null, mockSetters[key]];
    },
  };
});

// NOTE: imported after the mock factory above.
import useWaterfallSearchState from '@/hooks/useWaterfallSearchState';

describe('useWaterfallSearchState onSubmit', () => {
  beforeEach(() => {
    Object.keys(mockSetters).forEach(k => delete mockSetters[k]);
  });

  it('writes only the log filter when only the log filter is submitted', () => {
    const { result } = renderHook(() =>
      useWaterfallSearchState({ hasLogSource: true }),
    );

    result.current.onSubmit({
      logWhere: 'SeverityText:"error"',
      logWhereLanguage: 'lucene',
    });

    expect(setterFor('logWhere')).toHaveBeenCalledWith('SeverityText:"error"');
    expect(setterFor('logWhereLanguage')).toHaveBeenCalledWith('lucene');
    expect(setterFor('traceWhere')).not.toHaveBeenCalled();
    expect(setterFor('traceWhereLanguage')).not.toHaveBeenCalled();
  });

  it('writes only the spans filter when only the spans filter is submitted', () => {
    const { result } = renderHook(() =>
      useWaterfallSearchState({ hasLogSource: true }),
    );

    result.current.onSubmit({ traceWhere: "StatusCode = 'Error'" });

    expect(setterFor('traceWhere')).toHaveBeenCalledWith(
      "StatusCode = 'Error'",
    );
    expect(setterFor('logWhere')).not.toHaveBeenCalled();
  });

  it('clears a filter submitted as empty', () => {
    const { result } = renderHook(() =>
      useWaterfallSearchState({ hasLogSource: true }),
    );

    result.current.onSubmit({ logWhere: '', logWhereLanguage: '' });

    expect(setterFor('logWhere')).toHaveBeenCalledWith(null);
    expect(setterFor('logWhereLanguage')).toHaveBeenCalledWith(null);
  });

  it('writes both filters when the waterfall submits its whole form', () => {
    const { result } = renderHook(() =>
      useWaterfallSearchState({ hasLogSource: true }),
    );

    result.current.onSubmit({
      traceWhere: "StatusCode = 'Error'",
      logWhere: 'SeverityText:"error"',
      traceWhereLanguage: 'sql',
      logWhereLanguage: 'lucene',
    });

    expect(setterFor('traceWhere')).toHaveBeenCalledWith(
      "StatusCode = 'Error'",
    );
    expect(setterFor('logWhere')).toHaveBeenCalledWith('SeverityText:"error"');
    expect(setterFor('traceWhereLanguage')).toHaveBeenCalledWith('sql');
    expect(setterFor('logWhereLanguage')).toHaveBeenCalledWith('lucene');
  });
});
