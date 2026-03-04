import { Locator, Page } from '@playwright/test';

import { WebhookAlertModalComponent } from './WebhookAlertModalComponent';

/**
 * SearchPageAlertModalComponent - Encapsulates the alert creation modal
 * that appears on the saved search page (DBSearchPageAlertModal).
 */
export class SearchPageAlertModalComponent {
  private readonly modal: Locator;
  private readonly addNewWebhookButtonLocator: Locator;
  private readonly createAlertButtonLocator: Locator;
  readonly webhookAlertModal: WebhookAlertModalComponent;

  constructor(page: Page) {
    this.modal = page.getByTestId('alerts-modal');
    this.addNewWebhookButtonLocator = page.getByTestId(
      'add-new-webhook-button',
    );
    this.createAlertButtonLocator = page.getByRole('button', {
      name: 'Create Alert',
    });
    this.webhookAlertModal = new WebhookAlertModalComponent(page);
  }

  get addNewWebhookButton() {
    return this.addNewWebhookButtonLocator;
  }

  /**
   * Add a new incoming webhook and wait for the webhook creation modal to
   * fully unmount. Uses `detached` state (not just `hidden`) because the
   * fixed-position overlay from the inner modal can linger after the root
   * loses its dimensions, blocking subsequent clicks in the outer modal.
   */
  async addWebhookAndWait(
    serviceType: 'Slack' | 'incident.io' | 'Generic',
    name: string,
    url: string,
  ) {
    await this.addNewWebhookButtonLocator.click();
    // Confirm the webhook form is open before filling it
    await this.webhookAlertModal.webhookNameInput.waitFor({ state: 'visible' });
    await this.webhookAlertModal.addWebhook(serviceType, name, url);
    // Wait for the webhook form to be fully removed from the DOM so the
    // fixed overlay is gone before we interact with the outer modal
    await this.webhookAlertModal.webhookNameInput.waitFor({
      state: 'detached',
      timeout: 10000,
    });
  }

  /**
   * Submit the alert creation form and wait for the modal to close.
   */
  async createAlert() {
    await this.createAlertButtonLocator.click();
    await this.modal.waitFor({ state: 'hidden' });
  }
}
