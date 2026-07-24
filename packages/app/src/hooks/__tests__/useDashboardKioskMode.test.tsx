import { act, renderHook } from '@testing-library/react';

const mockSetKioskMode = jest.fn();

jest.mock('nuqs', () => {
  const actual = jest.requireActual('nuqs');
  return {
    ...actual,
    // eslint-disable-next-line @eslint-react/no-unnecessary-use-prefix
    useQueryState: () => [false, mockSetKioskMode],
  };
});

jest.mock('@mantine/hooks', () => {
  const actual = jest.requireActual('@mantine/hooks');
  return {
    ...actual,
    useHotkeys: jest.fn(),
  };
});

import { useDashboardKioskMode } from '@/hooks/useDashboardKioskMode';

describe('useDashboardKioskMode', () => {
  let fullscreenElement: Element | null;
  let requestFullscreen: jest.Mock<Promise<void>, []>;
  let exitFullscreen: jest.Mock<Promise<void>, []>;

  beforeEach(() => {
    fullscreenElement = null;
    requestFullscreen = jest.fn().mockResolvedValue(undefined);
    exitFullscreen = jest.fn().mockResolvedValue(undefined);
    mockSetKioskMode.mockReset();

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen,
    });
  });

  it('exits kiosk mode when its native fullscreen session ends', () => {
    const { result } = renderHook(() => useDashboardKioskMode());

    act(() => result.current.enterKioskMode());
    expect(mockSetKioskMode).toHaveBeenCalledWith(true);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    fullscreenElement = document.documentElement;
    act(() => document.dispatchEvent(new Event('fullscreenchange')));
    fullscreenElement = null;
    act(() => document.dispatchEvent(new Event('fullscreenchange')));

    expect(mockSetKioskMode).toHaveBeenLastCalledWith(null);
  });

  it('keeps URL-only kiosk mode active across unrelated fullscreen changes', () => {
    renderHook(() => useDashboardKioskMode());

    fullscreenElement = document.body;
    act(() => document.dispatchEvent(new Event('fullscreenchange')));
    fullscreenElement = null;
    act(() => document.dispatchEvent(new Event('fullscreenchange')));

    expect(mockSetKioskMode).not.toHaveBeenCalled();
  });
});
