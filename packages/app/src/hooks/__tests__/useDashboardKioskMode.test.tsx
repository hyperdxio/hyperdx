import { act, renderHook } from '@testing-library/react';

const mockSetKioskMode = jest.fn();
let mockIsKiosk = false;

jest.mock('nuqs', () => {
  const actual = jest.requireActual('nuqs');
  return {
    ...actual,
    // eslint-disable-next-line @eslint-react/no-unnecessary-use-prefix
    useQueryState: () => [mockIsKiosk, mockSetKioskMode],
  };
});

jest.mock('@mantine/hooks', () => {
  const actual = jest.requireActual('@mantine/hooks');
  return {
    ...actual,
    useHotkeys: jest.fn(),
  };
});

import { useHotkeys } from '@mantine/hooks';

import { useDashboardKioskMode } from '@/hooks/useDashboardKioskMode';

function getEscapeHotkey() {
  const lastCall = jest.mocked(useHotkeys).mock.calls.at(-1);
  const items = lastCall?.[0] ?? [];
  return items.find(([key]) => key === 'Escape');
}

describe('useDashboardKioskMode', () => {
  let fullscreenElement: Element | null;
  let requestFullscreen: jest.Mock<Promise<void>, []>;
  let exitFullscreen: jest.Mock<Promise<void>, []>;

  beforeEach(() => {
    fullscreenElement = null;
    requestFullscreen = jest.fn().mockResolvedValue(undefined);
    exitFullscreen = jest.fn().mockResolvedValue(undefined);
    mockSetKioskMode.mockReset();
    mockIsKiosk = false;
    jest.mocked(useHotkeys).mockClear();

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

  it('changes kiosk URL state without controlling browser fullscreen', () => {
    const { result } = renderHook(() => useDashboardKioskMode());

    act(() => result.current.enterKioskMode());
    expect(mockSetKioskMode).toHaveBeenCalledWith(true);
    expect(requestFullscreen).not.toHaveBeenCalled();

    fullscreenElement = document.documentElement;
    act(() => result.current.exitKioskMode());
    expect(mockSetKioskMode).toHaveBeenLastCalledWith(null);
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it('keeps kiosk mode active when the user changes fullscreen state', () => {
    const { result } = renderHook(() => useDashboardKioskMode());

    act(() => result.current.enterKioskMode());
    mockSetKioskMode.mockClear();
    fullscreenElement = document.body;
    act(() => document.dispatchEvent(new Event('fullscreenchange')));
    fullscreenElement = null;
    act(() => document.dispatchEvent(new Event('fullscreenchange')));

    expect(mockSetKioskMode).not.toHaveBeenCalled();
  });

  // Regression: the Escape hotkey used to be registered as
  // `['Escape', exitKioskMode]`, which (a) fired regardless of kiosk state and
  // (b) preventDefaulted by default. Because Mantine's useHotkeys listens on
  // documentElement and bubbles before window-level Esc handlers, that marked
  // every Escape as handled and left the tile editor's docked settings panel —
  // which bails on `event.defaultPrevented` — unable to close on Esc.
  it('registers Escape without preventDefault so it never swallows the key', () => {
    renderHook(() => useDashboardKioskMode());
    const escape = getEscapeHotkey();
    expect(escape).toBeDefined();
    expect(escape?.[2]).toEqual({ preventDefault: false });
  });

  it('ignores Escape when not in kiosk mode', () => {
    mockIsKiosk = false;
    renderHook(() => useDashboardKioskMode());
    const escape = getEscapeHotkey();
    act(() => escape?.[1](new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(mockSetKioskMode).not.toHaveBeenCalled();
  });

  it('exits kiosk mode on Escape when active', () => {
    mockIsKiosk = true;
    renderHook(() => useDashboardKioskMode());
    const escape = getEscapeHotkey();
    act(() => escape?.[1](new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(mockSetKioskMode).toHaveBeenCalledWith(null);
  });
});
