import { renderHook } from '@testing-library/react';

import {
  COMPACT_MAX_WIDTH,
  useCompactViewport,
} from '@/components/CompactViewport/useCompactViewport';
import { useWindowSize } from '@/utils';

jest.mock('@/utils', () => ({
  useWindowSize: jest.fn(() => ({ width: undefined, height: undefined })),
}));

const useWindowSizeMock = jest.mocked(useWindowSize);

function setInnerWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  });
}

describe('useCompactViewport', () => {
  const originalInnerWidth = window.innerWidth;

  afterEach(() => {
    setInnerWidth(originalInnerWidth);
  });

  it('reads the window until the resize listener reports', () => {
    useWindowSizeMock.mockReturnValue({
      width: undefined,
      height: undefined,
    });
    setInnerWidth(COMPACT_MAX_WIDTH - 1);
    const { result, rerender } = renderHook(() => useCompactViewport());
    expect(result.current).toBe(true);

    setInnerWidth(COMPACT_MAX_WIDTH);
    rerender();
    expect(result.current).toBe(false);
  });

  it('is compact below the cutoff', () => {
    useWindowSizeMock.mockReturnValue({
      width: COMPACT_MAX_WIDTH - 1,
      height: 800,
    });
    const { result } = renderHook(() => useCompactViewport());
    expect(result.current).toBe(true);
  });

  it('is not compact at the cutoff', () => {
    useWindowSizeMock.mockReturnValue({
      width: COMPACT_MAX_WIDTH,
      height: 800,
    });
    const { result } = renderHook(() => useCompactViewport());
    expect(result.current).toBe(false);
  });
});
