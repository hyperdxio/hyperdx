import type { ObjectId } from '@/models';
import Alert from '@/models/alert';
import Webhook, {
  type WebhookDocument,
  WebhookService,
} from '@/models/webhook';
import { validateWebhookUrl } from '@/utils/validators';

export interface WebhookInput {
  name: string;
  service: WebhookService;
  url: string;
  description?: string;
  queryParams?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Create a team-scoped webhook. Shared by the internal API, External API v2, and
 * MCP; callers handle their own duplicate-key errors and secret redaction.
 */
export async function createWebhook(
  team: ObjectId | string,
  { name, service, url, description, queryParams, headers, body }: WebhookInput,
) {
  validateWebhookUrl({ service, url });

  return Webhook.create({
    team,
    name,
    service,
    url,
    description,
    queryParams,
    headers,
    body,
  });
}

export type UpdateWebhookResult =
  | { status: 'ok'; webhook: WebhookDocument }
  | { status: 'not_found' }
  | { status: 'conflict' };

/**
 * Update (full replace) a team-scoped webhook. Readable fields (description,
 * body) are set/cleared by presence; write-only fields (headers, queryParams)
 * are preserved when omitted and cleared on empty {} — or cleared outright when
 * the destination (url/service) changes, so stored secrets are never forwarded
 * to a new destination. Shared by External API v2 and MCP.
 */
export async function updateWebhook(
  team: ObjectId | string,
  webhookId: string,
  { name, service, url, description, queryParams, headers, body }: WebhookInput,
): Promise<UpdateWebhookResult> {
  const existing = await Webhook.findOne({ _id: webhookId, team });
  if (existing == null) {
    return { status: 'not_found' };
  }

  validateWebhookUrl({ service, url });

  const destinationChanged =
    url !== existing.url || service !== existing.service;

  const setFields: Record<string, unknown> = { name, service, url };
  const unsetFields: Record<string, 1> = {};

  if (description === undefined) unsetFields.description = 1;
  else setFields.description = description;

  if (body === undefined) unsetFields.body = 1;
  else setFields.body = body;

  if (headers === undefined) {
    if (destinationChanged) unsetFields.headers = 1;
  } else if (Object.keys(headers).length === 0) {
    unsetFields.headers = 1;
  } else {
    setFields.headers = headers;
  }

  if (queryParams === undefined) {
    if (destinationChanged) unsetFields.queryParams = 1;
  } else if (Object.keys(queryParams).length === 0) {
    unsetFields.queryParams = 1;
  } else {
    setFields.queryParams = queryParams;
  }

  const updateOp: Record<string, unknown> =
    Object.keys(unsetFields).length > 0
      ? { $set: setFields, $unset: unsetFields }
      : { $set: setFields };

  // Pin to the snapshotted url/service so a concurrent destination change
  // yields a conflict rather than attaching a secret to the wrong destination.
  const webhook = await Webhook.findOneAndUpdate(
    { _id: webhookId, team, url: existing.url, service: existing.service },
    updateOp,
    { new: true },
  );

  if (webhook == null) {
    const stillExists = await Webhook.exists({ _id: webhookId, team });
    return stillExists != null
      ? { status: 'conflict' }
      : { status: 'not_found' };
  }

  return { status: 'ok', webhook };
}

export type DeleteWebhookResult =
  | { status: 'ok'; webhook: WebhookDocument }
  | { status: 'not_found' }
  | { status: 'referenced'; alertCount: number };

/**
 * Delete a webhook for a team, blocking deletion while alerts still reference it
 * so we never orphan an alert onto a missing destination.
 */
export async function deleteWebhook(
  team: ObjectId | string,
  webhookId: string,
): Promise<DeleteWebhookResult> {
  // Match on webhookId alone (not channel.type) so a legacy/skewed alert that
  // still references this webhook also blocks deletion.
  const alertCount = await Alert.countDocuments({
    'channel.webhookId': webhookId,
    team,
  });
  if (alertCount > 0) {
    return { status: 'referenced', alertCount };
  }

  const deleted = await Webhook.findOneAndDelete({ _id: webhookId, team });
  if (deleted == null) {
    return { status: 'not_found' };
  }

  return { status: 'ok', webhook: deleted };
}
