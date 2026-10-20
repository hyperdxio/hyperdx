import { isNil, omitBy } from 'lodash';
import store from 'store2';
import type {
  MeApiResponse,
  TeamClickHouseSettings,
  TeamClickHouseSettingsUpdate,
} from '@hyperdx/common-utils/dist/types';

import { IS_LOCAL_MODE } from './config';

// Local mode has no team on the server, so its settings live in localStorage.
const LOCAL_TEAM_SETTINGS_KEY = 'hdx-local-team-settings';

function getLocalTeamSettings(): TeamClickHouseSettings {
  return store.get(LOCAL_TEAM_SETTINGS_KEY, {});
}

/** The team's ClickHouse settings. Read these instead of `me.team`. */
export function getTeamClickHouseSettings(
  me: MeApiResponse | null | undefined,
): TeamClickHouseSettings | undefined {
  return IS_LOCAL_MODE ? getLocalTeamSettings() : me?.team;
}

/** A null value resets that setting to its default, as the API does. */
export function updateLocalTeamSettings(
  updates: TeamClickHouseSettingsUpdate,
): TeamClickHouseSettings {
  store.set(
    LOCAL_TEAM_SETTINGS_KEY,
    omitBy({ ...getLocalTeamSettings(), ...updates }, isNil),
  );
  return getLocalTeamSettings();
}
