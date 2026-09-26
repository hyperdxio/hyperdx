import { useSyncExternalStore } from 'react';
import { QuerySettings } from '@hyperdx/common-utils/dist/types';

// ClickHouse leaves MATERIALIZED and ALIAS columns out of `SELECT *` unless
// these settings are on.
export const SELECT_ALL_COLUMNS_QUERY_SETTINGS: QuerySettings = [
  { setting: 'asterisk_include_materialized_columns', value: '1' },
  { setting: 'asterisk_include_alias_columns', value: '1' },
];

// ClickHouse names the setting in each rejection: READONLY (164),
// UNKNOWN_SETTING (115) and SETTING_CONSTRAINT_VIOLATION (452).
export function isSelectAllColumnsSettingRejected(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return SELECT_ALL_COLUMNS_QUERY_SETTINGS.some(({ setting }) =>
    message.includes(setting),
  );
}

// Connections whose user cannot change these settings (for example, a
// `readonly = 1` user), shared by every row lookup. Read it through
// useSyncExternalStore: the React Compiler memoizes plain reads.
const rejectingConnections = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setRejected(connection: string, rejected: boolean) {
  if (rejectingConnections.has(connection) === rejected) {
    return;
  }
  if (rejected) {
    rejectingConnections.add(connection);
  } else {
    rejectingConnections.delete(connection);
  }
  listeners.forEach(listener => listener());
}

export function markSelectAllColumnsSettingsRejected(connection: string) {
  setRejected(connection, true);
}

// Called when a connection is edited, so its new user gets the settings again.
export function forgetSelectAllColumnsSettingsRejection(connection: string) {
  setRejected(connection, false);
}

export function useSelectAllColumnsSettingsRejected(
  connection: string,
): boolean {
  return useSyncExternalStore(
    subscribe,
    () => rejectingConnections.has(connection),
    () => false,
  );
}
