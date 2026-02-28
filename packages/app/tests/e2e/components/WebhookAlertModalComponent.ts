import { Locator, Page } from '@playwright/test';

export class WebhookAlertModalComponent {
  private readonly modal: Locator;
  private readonly serviceTypeRadioGroup: Locator;
  private readonly webhookNameInput: Locator;
  private readonly webhookUrlInput: Locator;
  private readonly addWebhookButton: Locator;

  constructor(page: Page) {
    this.modal = page.getByTestId('alert-modal');
    this.serviceTypeRadioGroup = this.modal.getByTestId(
      'service-type-radio-group',
    );
    this.webhookNameInput = this.modal.getByTestId('webhook-name-input');
    this.webhookUrlInput = this.modal.getByTestId('webhook-url-input');
    this.addWebhookButton = this.modal.getByTestId('add-webhook-button');
  }

  selectService(service: 'Slack' | 'incident.io' | 'Generic'): Promise<void> {
    return this.serviceTypeRadioGroup
      .getByRole('radio', { name: service, exact: true })
      .click();
  }

  async addWebhook(
    serviceType: 'Slack' | 'incident.io' | 'Generic',
    name: string,
    url: string,
  ): Promise<void> {
    await this.modal.isVisible();
    await this.selectService(serviceType);
    await this.webhookNameInput.fill(name);
    await this.webhookUrlInput.fill(url);
    await this.addWebhookButton.click();
    await this.modal.isHidden();
  }
}
