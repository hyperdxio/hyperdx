import { Provider } from 'jotai';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { UserPreferencesModal } from '@/UserPreferencesModal';
import type { UserPreferences } from '@/useUserPreferences';

const STORAGE_KEY = 'hdx-user-preferences';

const renderModal = (stored?: Partial<UserPreferences>) => {
  window.localStorage.clear();
  if (stored) {
    window.localStorage.setItem(
      STORAGE_KEY,
      // `colorMode` is what marks stored preferences as already migrated.
      JSON.stringify({ colorMode: 'dark', ...stored }),
    );
  }
  return renderWithMantine(
    <Provider>
      <UserPreferencesModal opened onClose={() => {}} />
    </Provider>,
  );
};

const readStoredPreferences = (): UserPreferences =>
  JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');

describe('UserPreferencesModal', () => {
  describe('Time zone', () => {
    it('reflects a stored zone', () => {
      renderModal({ timeZone: 'Etc/UTC' });

      expect(screen.getByTestId('time-zone-select')).toHaveValue('UTC');
    });

    it('stores the selected zone', async () => {
      renderModal({ timeZone: 'local' });

      await userEvent.click(screen.getByTestId('time-zone-select'));
      await userEvent.click(
        await screen.findByRole('option', { name: /^UTC/, hidden: true }),
      );

      expect(readStoredPreferences().timeZone).toBe('Etc/UTC');
    });

    it.each([
      ['time-zone-utc', 'Asia/Tokyo', 'Etc/UTC'],
      ['time-zone-local', 'Etc/UTC', 'local'],
    ])(
      'stores the zone from the %s shortcut',
      async (testId, stored, expected) => {
        renderModal({ timeZone: stored });

        await userEvent.click(screen.getByTestId(testId));

        expect(readStoredPreferences().timeZone).toBe(expected);
      },
    );

    it('has no Default shortcut, since this is the default', () => {
      renderModal();
      expect(screen.queryByTestId('time-zone-default')).toBeNull();
    });
  });

  describe('Row click', () => {
    it('shows the default action for users with no stored preference', () => {
      renderModal();

      expect(screen.getByTestId('row-click-action-select')).toHaveValue(
        'Open side panel',
      );
    });

    it('reflects a stored preference', () => {
      renderModal({ rowClickAction: 'expand' });

      expect(screen.getByTestId('row-click-action-select')).toHaveValue(
        'Expand inline',
      );
    });

    it('stores the selected action', async () => {
      renderModal();

      await userEvent.click(screen.getByTestId('row-click-action-select'));
      await userEvent.click(
        await screen.findByRole('option', {
          name: 'Expand inline',
          hidden: true,
        }),
      );

      expect(screen.getByTestId('row-click-action-select')).toHaveValue(
        'Expand inline',
      );
      expect(readStoredPreferences().rowClickAction).toBe('expand');
    });
  });
});
