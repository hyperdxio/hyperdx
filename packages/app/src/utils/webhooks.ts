/**
 * The secondary detail shown beside a webhook when picking a destination for an
 * alert (issue #1780): its description if it has one, otherwise its (masked)
 * URL so the user can still tell where the alert posts. Returns undefined when
 * neither is set, so the caller can omit the line entirely.
 */
export function getWebhookDetail(webhook: {
  description?: string;
  url?: string;
}): string | undefined {
  const description = webhook.description?.trim();
  if (description) {
    return description;
  }
  return webhook.url?.trim() || undefined;
}
