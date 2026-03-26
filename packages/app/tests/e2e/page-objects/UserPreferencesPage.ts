/**
 * UserPreferencesPage - Page object for user menu and preferences interactions
 * Encapsulates all interactions with the user menu, preferences modal, and team settings
 */
import { Locator, Page } from '@playwright/test';

export class UserPreferencesPage {
  readonly page: Page;
  private readonly userMenuTrigger: Locator;
  private readonly preferencesMenuItem: Locator;
  private readonly teamSettingsMenuItem: Locator;
  private readonly preferencesDialog: Locator;

  constructor(page: Page) {
    this.page = page;
    this.userMenuTrigger = page.getByTestId('user-menu-trigger');
    this.preferencesMenuItem = page.getByTestId('user-preferences-menu-item');
    this.teamSettingsMenuItem = page.getByTestId('team-settings-menu-item');
    this.preferencesDialog = page.getByRole('dialog', {
      name: /Preferences/,
    });
  }

  async openUserMenu() {
    await this.userMenuTrigger.click();
  }

  async openPreferences() {
    await this.openUserMenu();
    await this.preferencesMenuItem.click();
  }

  async openTeamSettings() {
    await this.openUserMenu();
    await this.teamSettingsMenuItem.click();
  }

  get menuTrigger() {
    return this.userMenuTrigger;
  }

  get preferencesOption() {
    return this.preferencesMenuItem;
  }

  get teamSettingsOption() {
    return this.teamSettingsMenuItem;
  }

  get dialog() {
    return this.preferencesDialog;
  }
}
