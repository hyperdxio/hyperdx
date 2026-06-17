import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import {
  sourceSelectFilter,
  SourceSelectGroup,
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

describe('useFilteredSortedSourceItems (grouped by section)', () => {
  it('returns [] when sources is undefined', () => {
    const { result } = renderHook(() =>
      useFilteredSortedSourceItems({
        sources: undefined,
        groupBySection: true,
      }),
    );
    expect(result.current).toEqual([]);
  });

  it('groups by section header, sorts groups alphabetically with "Other" last, and labels within a group ascending', () => {
    const sources = [
      makeSource('rl', 'Refund Logs', SourceKind.Log, { section: 'Billing' }),
      makeSource('bl', 'Billing Logs', SourceKind.Log, { section: 'Billing' }),
      makeSource('cpl', 'Prod Logs', SourceKind.Log, {
        section: 'Control Plane Prod',
      }),
      // no section -> "Other"
      makeSource('loose', 'Ungrouped Source', SourceKind.Trace),
      // whitespace-only section is treated as unsectioned -> "Other"
      makeSource('blank', 'Blank Section', SourceKind.Metric, {
        section: '  ',
      } as Partial<TSource>),
    ];
    const { result } = renderHook(() =>
      useFilteredSortedSourceItems({ sources, groupBySection: true }),
    );
    expect(result.current).toEqual([
      {
        group: 'Billing',
        items: [
          { value: 'bl', label: 'Billing Logs' },
          { value: 'rl', label: 'Refund Logs' },
        ],
      },
      {
        group: 'Control Plane Prod',
        items: [{ value: 'cpl', label: 'Prod Logs' }],
      },
      {
        group: 'Other',
        items: [
          { value: 'blank', label: 'Blank Section' },
          { value: 'loose', label: 'Ungrouped Source' },
        ],
      },
    ]);
  });

  it('applies kind/connection/disabled filters before grouping', () => {
    const sources = [
      makeSource('bl', 'Billing Logs', SourceKind.Log, { section: 'Billing' }),
      makeSource('bt', 'Billing Traces', SourceKind.Trace, {
        section: 'Billing',
      }),
      makeSource('d', 'Disabled Logs', SourceKind.Log, {
        section: 'Billing',
        disabled: true,
      } as Partial<TSource>),
    ];
    const { result } = renderHook(() =>
      useFilteredSortedSourceItems({
        sources,
        allowedSourceKinds: [SourceKind.Log],
        groupBySection: true,
      }),
    );
    expect(result.current).toEqual([
      { group: 'Billing', items: [{ value: 'bl', label: 'Billing Logs' }] },
    ]);
  });

  it('stays flat (no lone "Other" header) until a source has a real section', () => {
    const sources = [
      makeSource('z', 'Zebra Logs', SourceKind.Log),
      makeSource('a', 'Apple Traces', SourceKind.Trace),
      // whitespace-only section is unsectioned, so still no real section
      makeSource('blank', 'Blank Section', SourceKind.Metric, {
        section: '  ',
      } as Partial<TSource>),
    ];
    const { result } = renderHook(() =>
      useFilteredSortedSourceItems({ sources, groupBySection: true }),
    );
    expect(result.current).toEqual([
      { value: 'a', label: 'Apple Traces' },
      { value: 'blank', label: 'Blank Section' },
      { value: 'z', label: 'Zebra Logs' },
    ]);
  });
});

describe('sourceSelectFilter', () => {
  const grouped: SourceSelectGroup[] = [
    {
      group: 'Billing',
      items: [
        { value: 'billing-logs', label: 'Billing Logs' },
        { value: 'billing-traces', label: 'Billing Traces' },
        { value: 'refund-logs', label: 'Refund Logs' },
      ],
    },
    {
      group: 'Control Plane Prod',
      items: [
        { value: 'cp-prod-logs', label: 'Prod Logs' },
        { value: 'cp-prod-traces', label: 'Prod Traces' },
      ],
    },
    {
      group: 'Control Plane Staging',
      items: [{ value: 'cp-staging-logs', label: 'Staging Logs' }],
    },
  ];
  const run = (search: string) =>
    sourceSelectFilter({ options: grouped, search, limit: Infinity });

  it('returns every group unchanged for a blank query', () => {
    expect(run('   ')).toEqual(grouped);
  });

  it('honors the Mantine limit by capping the total options across groups', () => {
    // Billing has three items; a limit of 2 truncates it and drops the
    // remaining groups, matching the OptionsFilter contract.
    expect(
      sourceSelectFilter({ options: grouped, search: '', limit: 2 }),
    ).toEqual([
      {
        group: 'Billing',
        items: [
          { value: 'billing-logs', label: 'Billing Logs' },
          { value: 'billing-traces', label: 'Billing Traces' },
        ],
      },
    ]);
  });

  it('treats the section header as a tag: a section name selects the whole section', () => {
    expect(run('billing')).toEqual([
      {
        group: 'Billing',
        items: [
          { value: 'billing-logs', label: 'Billing Logs' },
          { value: 'billing-traces', label: 'Billing Traces' },
          { value: 'refund-logs', label: 'Refund Logs' },
        ],
      },
    ]);
  });

  it('matches a partial section token', () => {
    expect(run('bill')).toEqual([
      {
        group: 'Billing',
        items: [
          { value: 'billing-logs', label: 'Billing Logs' },
          { value: 'billing-traces', label: 'Billing Traces' },
          { value: 'refund-logs', label: 'Refund Logs' },
        ],
      },
    ]);
  });

  it('AND-s a section token with a name token, including names without the section word', () => {
    // "Refund Logs" matches: "Billing" from the header, "Logs" from the name.
    expect(run('billing logs')).toEqual([
      {
        group: 'Billing',
        items: [
          { value: 'billing-logs', label: 'Billing Logs' },
          { value: 'refund-logs', label: 'Refund Logs' },
        ],
      },
    ]);
  });

  it('spans multiple sections that share the queried tokens', () => {
    expect(run('control plane')).toEqual([
      {
        group: 'Control Plane Prod',
        items: [
          { value: 'cp-prod-logs', label: 'Prod Logs' },
          { value: 'cp-prod-traces', label: 'Prod Traces' },
        ],
      },
      {
        group: 'Control Plane Staging',
        items: [{ value: 'cp-staging-logs', label: 'Staging Logs' }],
      },
    ]);
  });

  it('narrows to one section when a name token disambiguates', () => {
    expect(run('prod logs')).toEqual([
      {
        group: 'Control Plane Prod',
        items: [{ value: 'cp-prod-logs', label: 'Prod Logs' }],
      },
    ]);
  });

  it('drops groups left with no surviving items', () => {
    expect(run('refund')).toEqual([
      {
        group: 'Billing',
        items: [{ value: 'refund-logs', label: 'Refund Logs' }],
      },
    ]);
  });

  it('matches on name and section text only, not the signal kind', () => {
    // Through the real pipeline: the grouped builder emits value+label only,
    // so a Session-kind source named "RUM" cannot match "session", while a
    // Log-kind source named "Session Replay" matches on its name.
    const sources = [
      makeSource('rum', 'RUM', SourceKind.Session, { section: 'Billing' }),
      makeSource('replay', 'Session Replay', SourceKind.Log, {
        section: 'Billing',
      }),
    ];
    const { result } = renderHook(() =>
      useFilteredSortedSourceItems({ sources, groupBySection: true }),
    );
    expect(
      sourceSelectFilter({
        options: result.current,
        search: 'session',
        limit: Infinity,
      }),
    ).toEqual([
      {
        group: 'Billing',
        items: [{ value: 'replay', label: 'Session Replay' }],
      },
    ]);
  });
});
