import { expect, test } from '../utils/base-test';

test.describe('User Preferences', { tag: ['@core'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('load');
  });

  test('should open user menu and navigate to preferences', async ({
    page,
  }) => {
    await test.step('Open the user menu', async () => {
      await page.getByTestId('user-menu-trigger').click();
    });

    await test.step('Verify menu options are visible', async () => {
      await expect(
        page.getByTestId('user-preferences-menu-item'),
      ).toBeVisible();
      await expect(page.getByTestId('team-settings-menu-item')).toBeVisible();
    });

    await test.step('Click preferences menu item', async () => {
      await page.getByTestId('user-preferences-menu-item').click();
    });
  });

  test('should display preference options in the modal', async ({ page }) => {
    const preferencesDialog = page.getByRole('dialog', {
      name: /Preferences/,
    });

    await test.step('Open the preferences modal', async () => {
      await page.getByTestId('user-menu-trigger').click();
      await page.getByTestId('user-preferences-menu-item').click();
    });

    await test.step('Verify preferences modal is visible', async () => {
      await expect(preferencesDialog).toBeVisible();
    });

    await test.step('Verify time format setting is visible', async () => {
      await expect(
        preferencesDialog.filter({ hasText: 'Time format' }),
      ).toBeVisible();
    });

    await test.step('Verify UTC toggle is visible', async () => {
      await expect(preferencesDialog.getByText('Use UTC time')).toBeVisible();
    });

    await test.step('Verify color mode setting is visible', async () => {
      await expect(
        preferencesDialog.filter({ hasText: 'Color Mode' }),
      ).toBeVisible();
    });
  });

  test('should open user menu and navigate to team settings', async ({
    page,
  }) => {
    await test.step('Open the user menu', async () => {
      await page.getByTestId('user-menu-trigger').click();
    });

    await test.step('Click team settings menu item', async () => {
      await page.getByTestId('team-settings-menu-item').click();
    });

    await test.step('Verify navigation to team page', async () => {
      await expect(page).toHaveURL(/\/team/);
    });
  });

  test('should close user menu by pressing Escape', async ({ page }) => {
    await test.step('Open the user menu', async () => {
      await page.getByTestId('user-menu-trigger').click();
    });

    await test.step('Verify menu is open', async () => {
      await expect(
        page.getByTestId('user-preferences-menu-item'),
      ).toBeVisible();
    });

    await test.step('Press Escape to close the menu', async () => {
      await page.keyboard.press('Escape');
    });

    await test.step('Verify menu is closed', async () => {
      await expect(page.getByTestId('user-preferences-menu-item')).toBeHidden();
    });
  });
});
