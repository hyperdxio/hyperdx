import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { act, renderHook } from '@testing-library/react';

import {
  forgetSelectAllColumnsSettingsRejection,
  isSelectAllColumnsSettingRejected,
  markSelectAllColumnsSettingsRejected,
  useSelectAllColumnsSettingsRejected,
} from '@/hooks/useSelectAllColumnsSettingsRejection';

const ROW_QUERY =
  'SELECT *, Timestamp AS __hdx_timestamp FROM default.otel_logs WHERE id = 1 LIMIT 1 SETTINGS asterisk_include_materialized_columns = 1, asterisk_include_alias_columns = 1';

// The shape the row query sees: the client's parsed error (message without the
// code, plus `code` and `type`) wrapped in a ClickHouseQueryError.
function queryError(message: string, code: string, type: string) {
  const error = new ClickHouseQueryError(message, ROW_QUERY);
  error.cause = Object.assign(new Error(message), { code, type });
  return error;
}

describe('isSelectAllColumnsSettingRejected', () => {
  it.each([
    [
      "Cannot modify 'asterisk_include_materialized_columns' setting in readonly mode. ",
      '164',
      'READONLY',
    ],
    [
      'Setting asterisk_include_alias_columns should not be changed. ',
      '452',
      'SETTING_CONSTRAINT_VIOLATION',
    ],
    [
      "Unknown setting 'asterisk_include_alias_columns'. ",
      '115',
      'UNKNOWN_SETTING',
    ],
  ])('is true when ClickHouse rejects a setting: %s', (message, code, type) => {
    expect(
      isSelectAllColumnsSettingRejected(queryError(message, code, type)),
    ).toBe(true);
  });

  it('is false for an error that quotes the SETTINGS clause', () => {
    const syntaxError = queryError(
      `Syntax error: failed at position 88 ('LIMT') (line 1, col 88): LIMT 1 SETTINGS asterisk_include_materialized_columns = 1, asterisk_include_alias_columns = 1. Expected one of: LIMIT, OFFSET, SETTINGS. `,
      '62',
      'SYNTAX_ERROR',
    );
    expect(isSelectAllColumnsSettingRejected(syntaxError)).toBe(false);
  });

  it('is false when a different setting is rejected', () => {
    expect(
      isSelectAllColumnsSettingRejected(
        queryError(
          "Cannot modify 'max_rows_to_read' setting in readonly mode. ",
          '164',
          'READONLY',
        ),
      ),
    ).toBe(false);
  });

  it('is false for other errors', () => {
    expect(
      isSelectAllColumnsSettingRejected(
        queryError('Timeout exceeded. ', '159', 'TIMEOUT_EXCEEDED'),
      ),
    ).toBe(false);
    expect(
      isSelectAllColumnsSettingRejected(
        new Error("Unknown setting 'asterisk_include_alias_columns'"),
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
