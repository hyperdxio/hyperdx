jest.mock('../config', () => ({ IS_LOCAL_MODE: true }));

import {
  getTeamClickHouseSettings,
  updateLocalTeamSettings,
} from '@/teamSettings';

describe('team settings in local mode', () => {
  beforeEach(() => localStorage.clear());

  it('persists updates and resets a setting passed as null', () => {
    updateLocalTeamSettings({ queryTimeout: 30, searchRowLimit: 500 });
    updateLocalTeamSettings({ searchRowLimit: null });

    expect(getTeamClickHouseSettings(null)).toEqual({ queryTimeout: 30 });
  });
});
