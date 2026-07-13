import { Locator, Page } from '@playwright/test';

import { WebhookAlertModalComponent } from './WebhookAlertModalComponent';

/**
 * SearchPageAlertModalComponent - Encapsulates the alert creation modal
 * that appears on the saved search page (DBSearchPageAlertModal).
 */
export class SearchPageAlertModalComponent {
  readonly page: Page;
  private readonly modal: Locator;
  private readonly addNewWebhookButtonLocator: Locator;
  private readonly createAlertButtonLocator: Locator;
  private readonly webhookSelector: Locator;
  private readonly saveAlertButtonLocator: Locator;
  private readonly deleteAlertButtonLocator: Locator;
  readonly webhookAlertModal: WebhookAlertModalComponent;

  constructor(page: Page) {
    this.page = page;
    this.modal = page.getByTestId('alerts-modal');
    this.addNewWebhookButtonLocator = page.getByTestId(
      'add-new-webhook-button',
    );
    this.createAlertButtonLocator = page.getByRole('button', {
      name: 'Create Alert',
    });
    this.saveAlertButtonLocator = page.getByRole('button', {
      name: 'Save Alert',
    });
    this.deleteAlertButtonLocator = page.getByRole('button', {
      name: 'Delete Alert',
    });
    this.webhookSelector = page.getByTestId('select-webhook');
    this.webhookAlertModal = new WebhookAlertModalComponent(page);
  }

  /**
   * Explicitly select a webhook by name from the alerts modal's select-webhook
   * combobox. The webhook is usually auto-selected after creation, but not
   * always — call this to guarantee the selection. The Mantine Select input
   * is readonly, so we click to open the dropdown and click the option
   * rather than typing.
   */
  async selectWebhook(webhookName: string) {
    if ((await this.webhookSelector.inputValue()) === webhookName) {
      return;
    }
    await this.webhookSelector.click();
    await this.page
      .getByRole('option', { name: webhookName })
      .click({ timeout: 5000 });
  }

  get addNewWebhookButton() {
    return this.addNewWebhookButtonLocator;
  }

  /**
   * Select the threshold type from the NativeSelect inside the alerts modal.
   * Pass the option value (e.g. 'between', 'above', 'below').
   * The thresholdType NativeSelect is the first <select> rendered inside the modal.
   */
  async selectThresholdType(value: string) {
    await this.modal.locator('select').first().selectOption(value);
  }

  /**
   * Set the lower threshold value (first NumberInput in the alert form).
   * Mantine v9 NumberInput renders as <input inputmode="decimal"> (not type="number"),
   * so getByRole('spinbutton') does not match. We use the inputmode attribute instead.
   */
  async setThreshold(value: number) {
    const input = this.modal.locator('input[inputmode="decimal"]').first();
    await input.fill(String(value));
    await input.blur();
  }

  /**
   * Set the upper threshold value (thresholdMax — second NumberInput).
   * Only present after selecting a range threshold type (e.g. 'between').
   * Mantine v9 NumberInput renders as <input inputmode="decimal"> (not type="number"),
   * so getByRole('spinbutton') does not match. We use the inputmode attribute instead.
   */
  async setThresholdMax(value: number) {
    const input = this.modal.locator('input[inputmode="decimal"]').nth(1);
    await input.fill(String(value));
    await input.blur();
  }

  /** Returns the thresholdMax NumberInput locator for visibility assertions. */
  get thresholdMaxInput() {
    return this.modal.locator('input[inputmode="decimal"]').nth(1);
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
   * Set the note field in the alert form.
   */
  async setNote(note: string) {
    const noteInput = this.modal.getByTestId('alert-note-input');
    await noteInput.fill(note);
  }

  /**
   * Submit the alert creation form and wait for the modal to close.
   */
  async createAlert() {
    await this.createAlertButtonLocator.click();
    await this.modal.waitFor({ state: 'hidden' });
  }

  /**
   * Select an existing alert's tab by its zero-based index. Existing alerts
   * render as tabs labeled "Alert 1", "Alert 2", ... in the order returned by
   * the saved search. The "New Alert" tab is separate.
   */
  async selectExistingAlertTab(index: number) {
    await this.modal.getByRole('tab', { name: `Alert ${index + 1}` }).click();
  }

  /** Locator for the interval NativeSelect (2nd <select> in a threshold alert form). */
  private get intervalSelect() {
    return this.modal.locator('select').nth(1);
  }

  /**
   * Change the alert check interval. Pass the interval key (e.g. '1m', '5m').
   */
  async selectInterval(value: string) {
    await this.intervalSelect.selectOption(value);
  }

  /** Read the currently selected interval value (e.g. '1m', '5m'). */
  async getSelectedInterval() {
    return this.intervalSelect.inputValue();
  }

  /**
   * Submit edits to an existing alert via "Save Alert". Waits for the
   * PUT /api/alerts/:id so the test fails if the request is never sent, then
   * waits for the modal to close.
   */
  async saveAlert() {
    const updateResponse = this.page.waitForResponse(
      resp =>
        /\/api\/alerts\/[^/]+$/.test(resp.url()) &&
        resp.request().method() === 'PUT',
      { timeout: 10000 },
    );
    await this.saveAlertButtonLocator.click();
    await updateResponse;
    await this.modal.waitFor({ state: 'hidden' });
  }

  /**
   * Delete the currently open existing alert via "Delete Alert". Waits for the
   * DELETE request and the modal to close.
   */
  async deleteAlert() {
    const deleteResponse = this.page.waitForResponse(
      resp =>
        /\/api\/alerts\/[^/]+$/.test(resp.url()) &&
        resp.request().method() === 'DELETE',
      { timeout: 10000 },
    );
    await this.deleteAlertButtonLocator.click();
    await deleteResponse;
    await this.modal.waitFor({ state: 'hidden' });
  }
}
