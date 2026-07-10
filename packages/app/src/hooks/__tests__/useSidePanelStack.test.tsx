import { act, renderHook } from '@testing-library/react';

import { SourceFrame, Tab } from '@/components/DBRowSidePanel.types';

// In-memory nuqs so each side-panel param can be seeded and its setter
// inspected. Values are the already-parsed shapes the hook consumes (arrays /
// strings), not URL strings. Prefixed `mock` so jest.mock's factory can use it.
const mockQueryStore: Record<string, unknown> = {};
const mockSetters: Record<string, jest.Mock> = {};

function seedParam(key: string, value: unknown) {
  mockQueryStore[key] = value;
}
function setterFor(key: string) {
  if (!mockSetters[key]) mockSetters[key] = jest.fn();
  return mockSetters[key];
}
function resetQueryState() {
  Object.keys(mockQueryStore).forEach(k => delete mockQueryStore[k]);
  Object.keys(mockSetters).forEach(k => delete mockSetters[k]);
}

jest.mock('nuqs', () => {
  const actual = jest.requireActual('nuqs');
  return {
    ...actual,
    // eslint-disable-next-line @eslint-react/no-unnecessary-use-prefix
    useQueryState: (key: string, parser?: { defaultValue?: unknown }) => {
      const hasValue = Object.prototype.hasOwnProperty.call(
        mockQueryStore,
        key,
      );
      const fallback =
        parser && 'defaultValue' in parser ? parser.defaultValue : null;
      const value = hasValue ? mockQueryStore[key] : (fallback ?? null);
      if (!mockSetters[key]) mockSetters[key] = jest.fn();
      return [value, mockSetters[key]];
    },
  };
});

// NOTE: imported after the mock factories above, which close over the `mock*`
// helpers declared at the top of this file.
import useSidePanelStack, {
  deriveEffectiveTrail,
  reconcileTab,
} from '@/hooks/useSidePanelStack';

const FRAME: SourceFrame = {
  sourceId: 'trace-src',
  rowId: 'leaf-row',
  aliasWith: [],
  label: 'Trace',
  sourceKind: undefined,
};

describe('deriveEffectiveTrail', () => {
  it('keeps a trail whose owner matches the mounted row', () => {
    const out = deriveEffectiveTrail({
      rawSourceStack: [FRAME],
      rawNavStack: [],
      stackRoot: 'root-1',
      initialRowId: 'root-1',
    });
    expect(out.isStale).toBe(false);
    expect(out.sourceStack).toEqual([FRAME]);
  });

  it('discards a trail whose owner differs from the mounted row', () => {
    const out = deriveEffectiveTrail({
      rawSourceStack: [FRAME],
      rawNavStack: [],
      stackRoot: 'old-root',
      initialRowId: 'new-root',
    });
    expect(out.isStale).toBe(true);
    expect(out.sourceStack).toEqual([]);
    expect(out.navStack).toEqual([]);
  });

  it('treats an ownerless trail (no stackRoot) as stale', () => {
    const out = deriveEffectiveTrail({
      rawSourceStack: [FRAME],
      rawNavStack: [],
      stackRoot: null,
      initialRowId: 'some-row',
    });
    expect(out.isStale).toBe(true);
    expect(out.sourceStack).toEqual([]);
  });

  it('is not stale when there are no stacks at all', () => {
    const out = deriveEffectiveTrail({
      rawSourceStack: [],
      rawNavStack: [],
      stackRoot: null,
      initialRowId: 'root-1',
    });
    expect(out.isStale).toBe(false);
  });
});

describe('reconcileTab', () => {
  const available = [Tab.Overview, Tab.Parsed, Tab.Context];

  it('keeps a persisted tab that the source offers', () => {
    expect(reconcileTab(Tab.Parsed, available, Tab.Overview)).toBe(Tab.Parsed);
  });

  it('falls back to the default when the persisted tab is unavailable', () => {
    expect(reconcileTab(Tab.Trace, available, Tab.Overview)).toBe(Tab.Overview);
  });

  it('falls back to the default when no tab is persisted', () => {
    expect(reconcileTab(null, available, Tab.Overview)).toBe(Tab.Overview);
  });
});

describe('useSidePanelStack', () => {
  beforeEach(resetQueryState);

  it('exposes an owner-gated empty trail when the persisted trail is stale', () => {
    seedParam('sidePanelSourceStack', [FRAME]);
    seedParam('sidePanelStackRoot', 'old-root');
    const { result } = renderHook(() =>
      useSidePanelStack({ initialRowId: 'new-root' }),
    );
    expect(result.current.isStale).toBe(true);
    expect(result.current.sourceStack).toEqual([]);
  });

  it('pushSource records the frame + owner, resets nav, and jumps to the tab', () => {
    seedParam('sidePanelTab', Tab.Overview);
    const { result } = renderHook(() =>
      useSidePanelStack({ initialRowId: 'root-1' }),
    );

    act(() => result.current.pushSource(FRAME, Tab.Trace));

    // Frame appended, stamped with the tab active before the push (originTab).
    expect(setterFor('sidePanelSourceStack')).toHaveBeenCalledWith([
      { ...FRAME, originTab: Tab.Overview },
    ]);
    // Cross-source push clears the same-source drilldown stack...
    expect(setterFor('sidePanelNavStack')).toHaveBeenCalledWith([]);
    // ...records the owning root...
    expect(setterFor('sidePanelStackRoot')).toHaveBeenCalledWith('root-1');
    // ...and jumps to the destination tab.
    expect(setterFor('sidePanelTab')).toHaveBeenCalledWith(Tab.Trace);
  });

  it('pushSource on a stale trail starts fresh instead of extending old frames', () => {
    seedParam('sidePanelSourceStack', [FRAME]);
    seedParam('sidePanelStackRoot', 'old-root');
    const { result } = renderHook(() =>
      useSidePanelStack({ initialRowId: 'new-root' }),
    );

    const next: SourceFrame = { ...FRAME, rowId: 'fresh' };
    act(() => result.current.pushSource(next, Tab.Trace));

    // The new frame is the only one (the stale leaf is not carried over).
    expect(setterFor('sidePanelSourceStack')).toHaveBeenCalledWith([
      { ...next, originTab: undefined },
    ]);
    expect(setterFor('sidePanelStackRoot')).toHaveBeenCalledWith('new-root');
  });

  it('pushNav appends a same-source entry and records the owner', () => {
    seedParam('sidePanelTab', Tab.Overview);
    const { result } = renderHook(() =>
      useSidePanelStack({ initialRowId: 'root-1' }),
    );

    act(() =>
      result.current.pushNav(
        { rowId: 'ctx-row', aliasWith: [], label: 'Related' },
        Tab.Parsed,
      ),
    );

    expect(setterFor('sidePanelNavStack')).toHaveBeenCalledWith([
      {
        rowId: 'ctx-row',
        aliasWith: [],
        label: 'Related',
        originTab: Tab.Overview,
      },
    ]);
    expect(setterFor('sidePanelStackRoot')).toHaveBeenCalledWith('root-1');
    expect(setterFor('sidePanelTab')).toHaveBeenCalledWith(Tab.Parsed);
    // Re-persists the effective source stack (empty here) so a nav push never
    // leaves a source stack it did not own behind.
    expect(setterFor('sidePanelSourceStack')).toHaveBeenCalledWith([]);
  });

  it('pushNav on a stale trail clears the stale source stack it revives', () => {
    // A leftover source stack owned by a different row is still in the URL.
    seedParam('sidePanelSourceStack', [FRAME]);
    seedParam('sidePanelStackRoot', 'old-root');
    const { result } = renderHook(() =>
      useSidePanelStack({ initialRowId: 'new-root' }),
    );

    act(() =>
      result.current.pushNav(
        { rowId: 'ctx-row', aliasWith: [], label: 'Related' },
        Tab.Parsed,
      ),
    );

    // The stale source stack is overwritten with the effective (empty) stack, so
    // stamping the new owner below can't revive the old source frame.
    expect(setterFor('sidePanelSourceStack')).toHaveBeenCalledWith([]);
    expect(setterFor('sidePanelNavStack')).toHaveBeenCalledWith([
      {
        rowId: 'ctx-row',
        aliasWith: [],
        label: 'Related',
        originTab: undefined,
      },
    ]);
    expect(setterFor('sidePanelStackRoot')).toHaveBeenCalledWith('new-root');
  });

  it('popOne pops the nav leaf first, restoring its originTab', () => {
    seedParam('sidePanelSourceStack', [{ ...FRAME, originTab: Tab.Overview }]);
    seedParam('sidePanelNavStack', [
      { rowId: 'ctx', aliasWith: [], label: 'Ctx', originTab: Tab.Context },
    ]);
    seedParam('sidePanelStackRoot', 'root-1');
    const { result } = renderHook(() =>
      useSidePanelStack({ initialRowId: 'root-1' }),
    );

    let popped: string | undefined;
    act(() => {
      popped = result.current.popOne();
    });

    expect(popped).toBe('nav');
    expect(setterFor('sidePanelNavStack')).toHaveBeenCalledWith([]);
    expect(setterFor('sidePanelTab')).toHaveBeenCalledWith(Tab.Context);
    // The source frame is untouched while a nav entry remained.
    expect(setterFor('sidePanelSourceStack')).not.toHaveBeenCalled();
  });

  it('popOne pops the source frame when no nav entries remain', () => {
    seedParam('sidePanelSourceStack', [{ ...FRAME, originTab: Tab.Parsed }]);
    seedParam('sidePanelNavStack', []);
    seedParam('sidePanelStackRoot', 'root-1');
    const { result } = renderHook(() =>
      useSidePanelStack({ initialRowId: 'root-1' }),
    );

    let popped: string | undefined;
    act(() => {
      popped = result.current.popOne();
    });

    expect(popped).toBe('source');
    expect(setterFor('sidePanelSourceStack')).toHaveBeenCalledWith([]);
    expect(setterFor('sidePanelTab')).toHaveBeenCalledWith(Tab.Parsed);
  });

  it('popOne returns "none" when the trail is empty (caller exits)', () => {
    const { result } = renderHook(() =>
      useSidePanelStack({ initialRowId: 'root-1' }),
    );
    let popped: string | undefined;
    act(() => {
      popped = result.current.popOne();
    });
    expect(popped).toBe('none');
    expect(setterFor('sidePanelSourceStack')).not.toHaveBeenCalled();
  });

  it('two sequential pops collapse nav then source across re-renders (double Back)', () => {
    // A trail with both a same-source drilldown and a cross-source frame.
    seedParam('sidePanelSourceStack', [{ ...FRAME, originTab: Tab.Overview }]);
    seedParam('sidePanelNavStack', [
      { rowId: 'ctx', aliasWith: [], label: 'Ctx', originTab: Tab.Context },
    ]);
    seedParam('sidePanelStackRoot', 'root-1');
    const { result, rerender } = renderHook(() =>
      useSidePanelStack({ initialRowId: 'root-1' }),
    );

    // First Back pops the nav leaf and restores the tab it was entered from.
    let firstPop: string | undefined;
    act(() => {
      firstPop = result.current.popOne();
    });
    expect(firstPop).toBe('nav');
    expect(setterFor('sidePanelNavStack')).toHaveBeenLastCalledWith([]);
    expect(setterFor('sidePanelTab')).toHaveBeenLastCalledWith(Tab.Context);
    // The cross-source frame is untouched while a nav entry remained.
    expect(setterFor('sidePanelSourceStack')).not.toHaveBeenCalled();

    // Simulate the URL settling after the first pop (nav now empty) and the
    // component re-rendering before the user's second Back. popOne reads the
    // effective stacks from a closure, so the second pop must see this update.
    seedParam('sidePanelNavStack', []);
    rerender();

    // Second Back now pops the source frame and restores its origin tab.
    let secondPop: string | undefined;
    act(() => {
      secondPop = result.current.popOne();
    });
    expect(secondPop).toBe('source');
    expect(setterFor('sidePanelSourceStack')).toHaveBeenLastCalledWith([]);
    expect(setterFor('sidePanelTab')).toHaveBeenLastCalledWith(Tab.Overview);
  });

  it('invoking popOne twice within one act is safe (no re-render between pops)', () => {
    // Guards the rapid double-fire path (e.g. two Esc/Back before React commits
    // the first update). Without a re-render the memoized popOne still closes
    // over the pre-pop trail, so both calls target the same (nav) level rather
    // than corrupting state or throwing. The realistic two-level collapse is
    // covered by the cross-render test above.
    seedParam('sidePanelSourceStack', [{ ...FRAME, originTab: Tab.Overview }]);
    seedParam('sidePanelNavStack', [
      { rowId: 'ctx', aliasWith: [], label: 'Ctx', originTab: Tab.Context },
    ]);
    seedParam('sidePanelStackRoot', 'root-1');
    const { result } = renderHook(() =>
      useSidePanelStack({ initialRowId: 'root-1' }),
    );

    const popped: Array<'nav' | 'source' | 'none'> = [];
    act(() => {
      popped.push(result.current.popOne());
      popped.push(result.current.popOne());
    });

    expect(popped).toEqual(['nav', 'nav']);
    // The nav pop ran (idempotently), and the source frame was never dropped by
    // the stale second call.
    expect(setterFor('sidePanelNavStack')).toHaveBeenLastCalledWith([]);
    expect(setterFor('sidePanelSourceStack')).not.toHaveBeenCalled();
  });

  it('truncateTo slices both stacks and restores the dropped level tab', () => {
    seedParam('sidePanelSourceStack', [
      { ...FRAME, rowId: 'a', originTab: Tab.Overview },
      { ...FRAME, rowId: 'b', originTab: Tab.Trace },
    ]);
    seedParam('sidePanelNavStack', []);
    seedParam('sidePanelStackRoot', 'root-1');
    const { result } = renderHook(() =>
      useSidePanelStack({ initialRowId: 'root-1' }),
    );

    // Jump back to the first source frame (breadcrumb click).
    act(() => result.current.truncateTo(1, 0));

    expect(setterFor('sidePanelSourceStack')).toHaveBeenCalledWith([
      { ...FRAME, rowId: 'a', originTab: Tab.Overview },
    ]);
    // Restores the tab active before the dropped frame (index 1) was entered.
    expect(setterFor('sidePanelTab')).toHaveBeenCalledWith(Tab.Trace);
  });

  it('clearTrail nulls every nav param', () => {
    const { result } = renderHook(() =>
      useSidePanelStack({ initialRowId: 'root-1' }),
    );
    act(() => result.current.clearTrail());
    expect(setterFor('sidePanelSourceStack')).toHaveBeenCalledWith(null);
    expect(setterFor('sidePanelNavStack')).toHaveBeenCalledWith(null);
    expect(setterFor('sidePanelStackRoot')).toHaveBeenCalledWith(null);
    expect(setterFor('sidePanelTab')).toHaveBeenCalledWith(null);
  });
});
