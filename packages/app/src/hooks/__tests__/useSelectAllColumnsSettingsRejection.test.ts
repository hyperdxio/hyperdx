import { act, renderHook } from '@testing-library/react';

import {
  forgetSelectAllColumnsSettingsRejection,
  isSelectAllColumnsSettingRejected,
  markSelectAllColumnsSettingsRejected,
  useSelectAllColumnsSettingsRejected,
} from '@/hooks/useSelectAllColumnsSettingsRejection';

describe('isSelectAllColumnsSettingRejected', () => {
  it.each([
    "Code: 164. DB::Exception: Cannot modify 'asterisk_include_materialized_columns' setting in readonly mode. (READONLY)",
    'Code: 452. DB::Exception: Setting asterisk_include_alias_columns should not be changed. (SETTING_CONSTRAINT_VIOLATION)',
    "Code: 115. DB::Exception: Unknown setting 'asterisk_include_alias_columns'. (UNKNOWN_SETTING)",
  ])('is true when ClickHouse rejects a setting: %s', message => {
    expect(isSelectAllColumnsSettingRejected(new Error(message))).toBe(true);
  });

  it('is false for other errors', () => {
    expect(
      isSelectAllColumnsSettingRejected(
        new Error(
          'Code: 159. DB::Exception: Timeout exceeded. (TIMEOUT_EXCEEDED)',
        ),
      ),
    ).toBe(false);
    expect(isSelectAllColumnsSettingRejected(undefined)).toBe(false);
  });
});

describe('useSelectAllColumnsSettingsRejected', () => {
  it('follows a connection being marked and forgotten', () => {
    const { result } = renderHook(() =>
      useSelectAllColumnsSettingsRejected('conn-a'),
    );
    expect(result.current).toBe(false);

    act(() => markSelectAllColumnsSettingsRejected('conn-a'));
    expect(result.current).toBe(true);

    act(() => forgetSelectAllColumnsSettingsRejection('conn-a'));
    expect(result.current).toBe(false);
  });

  it('keeps connections apart', () => {
    act(() => markSelectAllColumnsSettingsRejected('conn-b'));

    const { result } = renderHook(() =>
      useSelectAllColumnsSettingsRejected('conn-c'),
    );
    expect(result.current).toBe(false);
  });
});
