import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import {
  useFilteredSortedSourceItems,
  useSourceKindMap,
} from '../sourceSelectUtils';

const makeSource = (
  id: string,
  name: string,
  kind: SourceKind,
  overrides: Partial<TSource> = {},
): TSource =>
  ({
    id,
    name,
    kind,
    connection: 'conn-a',
    ...overrides,
  }) as unknown as TSource;

describe('useSourceKindMap', () => {
  it('returns an empty map when sources is undefined', () => {
    const { result } = renderHook(() => useSourceKindMap(undefined));
    expect(result.current.size).toBe(0);
  });

  it('builds an id -> kind lookup from the provided sources', () => {
    const sources = [
      makeSource('a', 'Logs', SourceKind.Log),
      makeSource('b', 'Traces', SourceKind.Trace),
      makeSource('c', 'Metrics', SourceKind.Metric),
    ];
    const { result } = renderHook(() => useSourceKindMap(sources));
    expect(result.current.get('a')).toBe(SourceKind.Log);
    expect(result.current.get('b')).toBe(SourceKind.Trace);
    expect(result.current.get('c')).toBe(SourceKind.Metric);
    expect(result.current.get('missing')).toBeUndefined();
  });

  it('returns a stable reference when the sources reference is unchanged', () => {
    const sources = [makeSource('a', 'Logs', SourceKind.Log)];
    const { result, rerender } = renderHook(
      ({ s }: { s: TSource[] }) => useSourceKindMap(s),
      { initialProps: { s: sources } },
    );
    const first = result.current;
    rerender({ s: sources });
    expect(result.current).toBe(first);
  });
});

describe('useFilteredSortedSourceItems', () => {
  const sources: TSource[] = [
    makeSource('z', 'Zebra Logs', SourceKind.Log),
    makeSource('a', 'Apple Traces', SourceKind.Trace, { connection: 'conn-b' }),
    makeSource('m', 'Mango Metrics', SourceKind.Metric),
    makeSource('d', 'Disabled', SourceKind.Log, {
      disabled: true,
    } as Partial<TSource>),
  ];

  it('returns [] when sources is undefined', () => {
    const { result } = renderHook(() =>
      useFilteredSortedSourceItems({ sources: undefined }),
    );
    expect(result.current).toEqual([]);
  });

  it('omits disabled sources and sorts by label ascending', () => {
    const { result } = renderHook(() =>
      useFilteredSortedSourceItems({ sources }),
    );
    expect(result.current).toEqual([
      { value: 'a', label: 'Apple Traces' },
      { value: 'm', label: 'Mango Metrics' },
      { value: 'z', label: 'Zebra Logs' },
    ]);
  });

  it('filters by allowedSourceKinds', () => {
    const { result } = renderHook(() =>
      useFilteredSortedSourceItems({
        sources,
        allowedSourceKinds: [SourceKind.Trace, SourceKind.Metric],
      }),
    );
    expect(result.current.map(i => i.value)).toEqual(['a', 'm']);
  });

  it('filters by connectionId', () => {
    const { result } = renderHook(() =>
      useFilteredSortedSourceItems({ sources, connectionId: 'conn-b' }),
    );
    expect(result.current.map(i => i.value)).toEqual(['a']);
  });

  it('combines allowedSourceKinds + connectionId (AND semantics)', () => {
    const { result } = renderHook(() =>
      useFilteredSortedSourceItems({
        sources,
        allowedSourceKinds: [SourceKind.Log],
        connectionId: 'conn-b',
      }),
    );
    expect(result.current).toEqual([]);
  });

  it('returns a stable reference when inputs are unchanged', () => {
    const { result, rerender } = renderHook(
      (props: {
        sources: TSource[];
        allowedSourceKinds?: SourceKind[];
        connectionId?: string;
      }) => useFilteredSortedSourceItems(props),
      { initialProps: { sources } },
    );
    const first = result.current;
    rerender({ sources });
    expect(result.current).toBe(first);
  });
});
