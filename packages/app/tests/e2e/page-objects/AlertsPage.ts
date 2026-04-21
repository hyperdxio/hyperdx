/**
 * AlertsPage - Page object for the /alerts page
 * Encapsulates all interactions with the alerts interface
 * Currently not used until Alerts tests are implemented
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

  /**
   * Get the alert card that contains a given name (saved search or dashboard/tile name).
   * Scopes all further lookups to a single alert row so assertions aren't polluted
   * by other tests' data.
   */
  getAlertCardByName(name: string) {
    return this.alertsPageContainer
      .locator('[data-testid^="alert-card-"]')
      .filter({ hasText: name });
  }

  /**
   * Get the error-indicator icon button inside a given alert card.
   * The icon is only rendered when the alert has recorded execution errors.
   */
  getErrorIconForAlertCard(alertCard: Locator) {
    return alertCard.locator('[data-testid^="alert-error-icon-"]');
  }

  /**
   * Get the error details modal (rendered at the page level via Mantine portal).
   * The modal is identified by its Mantine role and title rather than by the
   * per-alert data-testid so callers don't need to know the alert id.
   */
  get errorModal() {
    return this.page.getByRole('dialog', { name: 'Alert Execution Errors' });
  }

  /**
   * Get the full error message Code block inside the currently-open error modal.
   * Uses the native <code> role so we don't leak styling-level implementation
   * details (the Mantine Code component renders as <code>).
   */
  get errorModalMessage() {
    return this.errorModal.locator('pre');
  }

  /**
   * Open the error modal for an alert card and wait for it to become visible.
   */
  async openErrorModalForAlertCard(alertCard: Locator) {
    const icon = this.getErrorIconForAlertCard(alertCard);
    await icon.scrollIntoViewIfNeeded();
    await icon.click();
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
