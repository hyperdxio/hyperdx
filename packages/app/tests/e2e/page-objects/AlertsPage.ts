/**
 * AlertsPage - Page object for the /alerts page
 * Encapsulates all interactions with the alerts interface
 */
import { Locator, Page } from '@playwright/test';

import { WebhookAlertModalComponent } from '../components/WebhookAlertModalComponent';

export class AlertsPage {
  readonly page: Page;
  readonly webhookAlertModal: WebhookAlertModalComponent;

  private readonly alertsPageContainer: Locator;
  private readonly alertsButton: Locator;
  private readonly alertDialog: Locator;
  private readonly emptyState: Locator;
  private readonly savedSearchNameInput: Locator;
  private readonly alertFormSubmit: Locator;
  private readonly alertFormDelete: Locator;
  private readonly addNewWebhookButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.alertsPageContainer = page.getByTestId('alerts-page');
    this.alertsButton = page.getByTestId('alerts-button');
    // Mantine Modal renders visible content in a Portal with aria-modal="true",
    // while the root data-testid element stays hidden. Use aria-modal to
    // distinguish from Popover dialogs which lack this attribute.
    this.alertDialog = page.locator('[aria-modal="true"]');
    this.emptyState = page.getByTestId('alerts-empty-state');
    this.savedSearchNameInput = page.getByTestId('saved-search-name-input');
    this.alertFormSubmit = page.getByTestId('alert-form-submit');
    this.alertFormDelete = page.getByTestId('alert-form-delete');
    this.addNewWebhookButton = page.getByTestId('add-new-webhook-button');
    this.webhookAlertModal = new WebhookAlertModalComponent(page);
  }

  async goto() {
    await this.page.goto('/alerts');
  }

  getAlertCards() {
    return this.page.locator('[data-testid^="alert-card-"]');
  }

  getAlertCard(index: number) {
    return this.getAlertCards().nth(index);
  }

  getAlertLink(cardIndex: number = 0) {
    const card = this.getAlertCard(cardIndex);
    return card.locator('[data-testid^="alert-link-"]');
  }

  /**
   * Open alerts modal from the search page
   */
  async openAlertsModalFromSearch() {
    await this.alertsButton.scrollIntoViewIfNeeded();
    await this.alertsButton.click();
    await this.alertDialog.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Fill saved search name (only shown when creating from unsaved search)
   */
  async fillSavedSearchName(name: string) {
    await this.savedSearchNameInput.fill(name);
  }

  /**
   * Create a new webhook inside the alert modal
   */
  async createWebhook(
    serviceType: 'Slack' | 'incident.io' | 'Generic',
    name: string,
    url: string,
  ) {
    await this.addNewWebhookButton.click();
    await this.webhookAlertModal.addWebhook(serviceType, name, url);
  }

  /**
   * Submit the alert form (creates or saves)
   */
  async submitAlertForm() {
    await this.alertFormSubmit.click();
  }

  /**
   * Delete an alert from the alert modal
   */
  async deleteAlertFromModal() {
    await this.alertFormDelete.click();
  }

  /**
   * Click on an existing alert tab in the alert modal (by index)
   */
  async selectAlertTab(index: number) {
    await this.alertDialog
      .getByRole('tab', { name: `Alert ${index + 1}` })
      .click();
  }

  /**
   * Click the "New Alert" tab in the alert modal
   */
  async selectNewAlertTab() {
    await this.alertDialog.getByRole('tab', { name: 'New Alert' }).click();
  }

  get pageContainer() {
    return this.alertsPageContainer;
  }

  get searchPageAlertsButton() {
    return this.alertsButton;
  }

  get modal() {
    return this.alertDialog;
  }

  get emptyStateMessage() {
    return this.emptyState;
  }

  get submitButton() {
    return this.alertFormSubmit;
  }

  get deleteButton() {
    return this.alertFormDelete;
  }
}
