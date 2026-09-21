import { Provider } from 'jotai';
import { act, renderHook } from '@testing-library/react';

import { CONTENT_FONT_SIZES } from '@/config/fonts';
import { useContentFontSize, useUserPreferences } from '@/useUserPreferences';

const STORAGE_KEY = 'hdx-user-preferences';

const renderContentFontSize = () =>
  renderHook(
    () => ({
      resolved: useContentFontSize(),
      preferences: useUserPreferences(),
    }),
    { wrapper: Provider },
  );

describe('useContentFontSize', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  // The `sm` scale is what every content surface had hardcoded before the
  // preference existed, so it has to stay the default.
  it('defaults to the small scale', () => {
    const { result } = renderContentFontSize();

    expect(CONTENT_FONT_SIZES.sm).toEqual({ base: 12, compact: 11 });
    expect(result.current.resolved).toEqual({
      contentFontSize: 'sm',
      ...CONTENT_FONT_SIZES.sm,
      scale: 1,
    });
  });

  it('falls back to the default for preferences stored before the setting existed', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        isUTC: true,
        timeFormat: '24h',
        colorMode: 'dark',
        font: 'Inter',
      }),
    );

    const { result } = renderContentFontSize();

    expect(result.current.resolved.contentFontSize).toBe('sm');
  });

  it('loads a non-default preference saved in a previous session', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        isUTC: false,
        timeFormat: '12h',
        colorMode: 'dark',
        font: 'IBM Plex Mono',
        contentFontSize: 'md',
      }),
    );

    const { result } = renderContentFontSize();

    expect(result.current.resolved).toEqual({
      contentFontSize: 'md',
      ...CONTENT_FONT_SIZES.md,
      scale: CONTENT_FONT_SIZES.md.base / CONTENT_FONT_SIZES.sm.base,
    });
  });

  it('resolves the stored preference', () => {
    const { result } = renderContentFontSize();

    act(() =>
      result.current.preferences.setUserPreference({ contentFontSize: 'lg' }),
    );

    expect(result.current.resolved).toEqual({
      contentFontSize: 'lg',
      ...CONTENT_FONT_SIZES.lg,
      scale: CONTENT_FONT_SIZES.lg.base / CONTENT_FONT_SIZES.sm.base,
    });
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}'),
    ).toEqual(expect.objectContaining({ contentFontSize: 'lg' }));
  });
});
