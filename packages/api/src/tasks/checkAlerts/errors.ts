export const WEBHOOK_REDIRECT_ERROR_MESSAGE =
  'Webhook destination responded with a redirect. Redirects are not supported.';

export class WebhookRedirectError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(WEBHOOK_REDIRECT_ERROR_MESSAGE);
    this.name = 'WebhookRedirectError';
    this.status = status;
  }
}
