import { renderHook } from '@testing-library/react';

import { useCrossChartPinDismiss } from '@/components/DBTimeChart/crossChartPin';

/**
 * The registry backing this hook is module-level and survives renders, unmounts
 * and every test in this file's worker — deliberately, because charts can be
 * scattered with no common provider. That makes leaks between consumers a real
 * failure mode rather than a theoretical one, so the cases below cover both
 * directions: who gets dismissed, and who stops being reachable.
 */
describe('useCrossChartPinDismiss', () => {
  it('dismisses the other chart but not the one doing the pinning', () => {
    const dismissA = jest.fn();
    const dismissB = jest.fn();

    const a = renderHook(() => useCrossChartPinDismiss(dismissA));
    renderHook(() => useCrossChartPinDismiss(dismissB));

    a.result.current();

    expect(dismissB).toHaveBeenCalledTimes(1);
    expect(dismissA).not.toHaveBeenCalled();
  });

  it('stops calling a consumer once it unmounts', () => {
    const dismissA = jest.fn();
    const dismissB = jest.fn();

    const a = renderHook(() => useCrossChartPinDismiss(dismissA));
    const b = renderHook(() => useCrossChartPinDismiss(dismissB));

    b.unmount();
    a.result.current();

    // A stale entry here would call into an unmounted component's setState on
    // every pin, for the life of the page.
    expect(dismissB).not.toHaveBeenCalled();
  });

  it('calls the latest callback, not the one from the first render', () => {
    const first = jest.fn();
    const second = jest.fn();

    const a = renderHook(() => useCrossChartPinDismiss(jest.fn()));
    const b = renderHook(({ cb }) => useCrossChartPinDismiss(cb), {
      initialProps: { cb: first },
    });

    b.rerender({ cb: second });
    a.result.current();

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('dismisses every other consumer, not just one', () => {
    const dismissA = jest.fn();
    const others = [jest.fn(), jest.fn(), jest.fn()];

    const a = renderHook(() => useCrossChartPinDismiss(dismissA));
    others.forEach(cb => renderHook(() => useCrossChartPinDismiss(cb)));

    a.result.current();

    others.forEach(cb => expect(cb).toHaveBeenCalledTimes(1));
    expect(dismissA).not.toHaveBeenCalled();
  });
});
