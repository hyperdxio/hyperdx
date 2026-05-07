import { UserPreferencesPage } from '../page-objects/UserPreferencesPage';
import { expect, test } from '../utils/base-test';

test.describe('User Preferences', { tag: ['@core'] }, () => {
  let userPreferencesPage: UserPreferencesPage;

  test.beforeEach(async ({ page }) => {
    userPreferencesPage = new UserPreferencesPage(page);
    await page.goto('/search');
    await page.waitForLoadState('load');
  });

  test('should open user menu and navigate to preferences', async () => {
    await test.step('Open the user menu', async () => {
      await userPreferencesPage.openUserMenu();
    });

    await test.step('Verify menu options are visible', async () => {
      await expect(userPreferencesPage.preferencesOption).toBeVisible();
      await expect(userPreferencesPage.teamSettingsOption).toBeVisible();
    });

    await test.step('Click preferences menu item', async () => {
      await userPreferencesPage.preferencesOption.click();
    });
  });

  test('should display preference options in the modal', async () => {
    await test.step('Open the preferences modal', async () => {
      await userPreferencesPage.openPreferences();
    });

    await test.step('Verify preferences modal is visible', async () => {
      await expect(userPreferencesPage.dialog).toBeVisible();
    });

    await test.step('Verify time format setting is visible', async () => {
      await expect(
        userPreferencesPage.dialog.filter({ hasText: 'Time format' }),
      ).toBeVisible();
    });

    await test.step('Verify UTC toggle is visible', async () => {
      await expect(
        userPreferencesPage.dialog.getByText('Use UTC time'),
      ).toBeVisible();
    });

    await test.step('Verify color mode setting is visible', async () => {
      await expect(
        userPreferencesPage.dialog.filter({ hasText: 'Color Mode' }),
      ).toBeVisible();
    });
  });

  test('should open user menu and navigate to team settings', async ({
    page,
  }) => {
    await test.step('Open the user menu and click team settings', async () => {
      await userPreferencesPage.openTeamSettings();
    });

    await test.step('Verify navigation to team page', async () => {
      await expect(page).toHaveURL(/\/team/);
    });
  });

  test('should close user menu by pressing Escape', async () => {
    await test.step('Open the user menu', async () => {
      await userPreferencesPage.openUserMenu();
    });

    await test.step('Verify menu is open', async () => {
      await expect(userPreferencesPage.preferencesOption).toBeVisible();
    });

    await test.step('Press Escape to close the menu', async () => {
      await userPreferencesPage.page.keyboard.press('Escape');
    });

    await test.step('Verify menu is closed', async () => {
      await expect(userPreferencesPage.preferencesOption).toBeHidden();
    });
  });
});
