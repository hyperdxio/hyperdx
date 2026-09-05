import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';
import { renderHook } from '@testing-library/react';

import { useResolvedSourceParam } from '@/hooks/useResolvedSourceParam';
import { useSources } from '@/source';

jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}));

jest.mock('@/source', () => ({
  useSources: jest.fn(),
}));

const mockUseSources = jest.mocked(useSources);

const LOGS = { id: 'log-1', name: 'E2E Logs', kind: SourceKind.Log };
const OTHER_LOGS = { id: 'log-2', name: 'E2E Logs', kind: SourceKind.Log };
const TRACES = { id: 'trace-1', name: 'E2E Traces', kind: SourceKind.Trace };

function mockSources(sources: unknown[] | undefined) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  mockUseSources.mockReturnValue({ data: sources } as ReturnType<
    typeof useSources
  >);
}

describe('useResolvedSourceParam', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves nothing while sources are loading, then resolves the name', () => {
    mockSources(undefined);
    const { result, rerender } = renderHook(() =>
      useResolvedSourceParam('E2E Logs', { kinds: [SourceKind.Log] }),
    );
    expect(result.current.source).toBeUndefined();

    mockSources([LOGS, TRACES]);
    rerender();
    expect(result.current.source).toBe(LOGS);
    expect(notifications.show).not.toHaveBeenCalled();
  });

  it('resolves an ID param directly', () => {
    mockSources([LOGS, TRACES]);
    const { result } = renderHook(() => useResolvedSourceParam('trace-1'));
    expect(result.current.source).toBe(TRACES);
    expect(notifications.show).not.toHaveBeenCalled();
  });

  it('warns once when several sources share the matched name', () => {
    mockSources([LOGS, OTHER_LOGS]);
    const { result, rerender } = renderHook(() =>
      useResolvedSourceParam('E2E Logs', { kinds: [SourceKind.Log] }),
    );

    expect(result.current.source).toBe(LOGS);
    expect(notifications.show).toHaveBeenCalledTimes(1);
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ambiguous-source-name-E2E Logs',
        color: 'yellow',
      }),
    );

    rerender();
    // A background refetch of ['sources'] hands back a new array with equal
    // contents — the warning must not fire again.
    mockSources([{ ...LOGS }, { ...OTHER_LOGS }]);
    rerender();
    expect(notifications.show).toHaveBeenCalledTimes(1);
  });

  it('resolves no source for a name of the wrong kind', () => {
    mockSources([LOGS, TRACES]);
    const { result } = renderHook(() =>
      useResolvedSourceParam('E2E Traces', { kinds: [SourceKind.Log] }),
    );
    expect(result.current.source).toBeUndefined();
  });

  it('warns once when the param matches no source', () => {
    mockSources([LOGS, TRACES]);
    const { rerender } = renderHook(() =>
      useResolvedSourceParam('Deleted Logs', { kinds: [SourceKind.Log] }),
    );

    expect(notifications.show).toHaveBeenCalledTimes(1);
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'source-param-unresolved-Deleted Logs',
        color: 'yellow',
        title: 'Source not found',
      }),
    );

    rerender();
    mockSources([{ ...LOGS }, { ...TRACES }]);
    rerender();
    expect(notifications.show).toHaveBeenCalledTimes(1);
  });

  it('says so when the param names a source of the wrong kind', () => {
    mockSources([LOGS, TRACES]);
    renderHook(() =>
      useResolvedSourceParam('trace-1', { kinds: [SourceKind.Log] }),
    );

    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'source-param-unresolved-trace-1',
        title: "Source can't be used here",
        message: expect.stringContaining('trace source'),
      }),
    );
  });

  it('stays quiet about an unresolved param while sources are loading', () => {
    mockSources(undefined);
    const { rerender } = renderHook(() =>
      useResolvedSourceParam('Deleted Logs', { kinds: [SourceKind.Log] }),
    );
    expect(notifications.show).not.toHaveBeenCalled();

    // ...and only warns once the list has actually arrived.
    mockSources([LOGS, TRACES]);
    rerender();
    expect(notifications.show).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when there is no param at all', () => {
    mockSources([LOGS, TRACES]);
    renderHook(() => useResolvedSourceParam(null, { kinds: [SourceKind.Log] }));
    renderHook(() => useResolvedSourceParam('', { kinds: [SourceKind.Log] }));
    expect(notifications.show).not.toHaveBeenCalled();
  });

  it('resolves no source for a wrong-kind ID', () => {
    // Parity with useSource's select, so the caller's own fallback applies.
    mockSources([LOGS, TRACES]);
    const { result } = renderHook(() =>
      useResolvedSourceParam('trace-1', { kinds: [SourceKind.Log] }),
    );
    expect(result.current.source).toBeUndefined();
  });

  it('resolves no source for an unknown value', () => {
    mockSources([LOGS, TRACES]);
    const { result } = renderHook(() => useResolvedSourceParam('nope'));
    expect(result.current.source).toBeUndefined();
  });

  it('keeps a stable return across re-renders so callers can use it as a dep', () => {
    mockSources([LOGS, TRACES]);
    const { result, rerender } = renderHook(() =>
      useResolvedSourceParam('E2E Logs', { kinds: [SourceKind.Log] }),
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    expect(result.current.source).toBe(LOGS);
  });
});
