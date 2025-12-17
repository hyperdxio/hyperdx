/**
 * AlertsPage - Page object for the /alerts page
 * Encapsulates all interactions with the alerts interface
 */
import { Locator, Page } from '@playwright/test';

export class AlertsPage {
  readonly page: Page;
  private readonly alertsPageContainer: Locator;
  private readonly alertsButton: Locator;
  private readonly alertsModal: Locator;

  constructor(page: Page) {
    this.page = page;
    this.alertsPageContainer = page.locator('[data-testid="alerts-page"]');
    this.alertsButton = page.locator('[data-testid="alerts-button"]');
    this.alertsModal = page.locator('[data-testid="alerts-modal"]');
  }

  /**
   * Navigate to the alerts page
   */
  async goto() {
    await this.page.goto('/alerts');
  }

  /**
   * Get all alert cards
   */
  getAlertCards() {
    return this.page.locator('[data-testid^="alert-card-"]');
  }

  /**
   * Get a specific alert card by index
   */
  getAlertCard(index: number) {
    return this.getAlertCards().nth(index);
  }

  /**
   * Get the first alert card
   */
  getFirstAlertCard() {
    return this.getAlertCards().first();
  }

  /**
   * Get alert link for a specific alert card
   */
  getAlertLink(cardIndex: number = 0) {
    const card = this.getAlertCard(cardIndex);
    return card.locator('[data-testid^="alert-link-"]');
  }

  /**
   * Open alerts creation modal
   */
  async openAlertsModal() {
    await this.alertsButton.scrollIntoViewIfNeeded();
    await this.alertsButton.click();
  }

  // Getters for assertions

  get pageContainer() {
    return this.alertsPageContainer;
  }

  get createButton() {
    return this.alertsButton;
  }

  get modal() {
    return this.alertsModal;
  }
}
