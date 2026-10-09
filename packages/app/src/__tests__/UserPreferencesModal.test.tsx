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
