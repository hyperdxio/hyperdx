import { act, renderHook } from '@testing-library/react';

import { useGroupExpansion } from '@/components/DBSearchPageFilters/useGroupExpansion';

const render = (defaultExpanded: boolean, isForceExpanded?: boolean) =>
  renderHook(
    (props: { defaultExpanded: boolean; isForceExpanded?: boolean }) =>
      useGroupExpansion(props.defaultExpanded, props.isForceExpanded),
    { initialProps: { defaultExpanded, isForceExpanded } },
  );

describe('useGroupExpansion', () => {
  it('follows its own state when no search is active', () => {
    const { result } = render(false);
    expect(result.current[0]).toBe(false);

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });

  it('opens while a search forces it, and can still be closed', () => {
    const { result, rerender } = render(false);
    rerender({ defaultExpanded: false, isForceExpanded: true });
    expect(result.current[0]).toBe(true);

    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });

  it('restores the browse state when the search ends', () => {
    const { result, rerender } = render(false);

    rerender({ defaultExpanded: false, isForceExpanded: true });
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);

    // Closing the search must not leave the group stuck open.
    rerender({ defaultExpanded: false, isForceExpanded: false });
    expect(result.current[0]).toBe(false);
  });

  it('leaves an expanded group expanded after a search closes it', () => {
    const { result, rerender } = render(false);
    act(() => result.current[1](true));

    rerender({ defaultExpanded: false, isForceExpanded: true });
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);

    rerender({ defaultExpanded: false, isForceExpanded: false });
    expect(result.current[0]).toBe(true);
  });

  it('reopens on a fresh search after the previous one was closed', () => {
    const { result, rerender } = render(false);

    rerender({ defaultExpanded: false, isForceExpanded: true });
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);

    rerender({ defaultExpanded: false, isForceExpanded: false });
    rerender({ defaultExpanded: false, isForceExpanded: true });
    expect(result.current[0]).toBe(true);
  });

  it('keeps a default-expansion signal raised during a search', () => {
    const { result, rerender } = render(false);
    rerender({ defaultExpanded: false, isForceExpanded: true });

    // The group gains a selection mid-search, so the caller's
    // default-expansion effect fires. That describes the browse state.
    act(() => result.current[2]());

    rerender({ defaultExpanded: true, isForceExpanded: false });
    expect(result.current[0]).toBe(true);
  });

  it('keeps the setter identity stable so callers can memoize on it', () => {
    const { result, rerender } = render(false);
    const setter = result.current[1];

    rerender({ defaultExpanded: false, isForceExpanded: true });
    act(() => result.current[1](false));

    expect(result.current[1]).toBe(setter);
  });
});
