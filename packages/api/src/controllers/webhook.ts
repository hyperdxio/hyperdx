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
 * Create a webhook for a team.
 *
 * Shared by the internal API router, the External API v2 router, and the MCP
 * server so webhook-creation invariants live in one place:
 *   - the destination URL passes SSRF/service validation (validateWebhookUrl)
 *   - persistence is scoped to the team
 *
 * Callers are responsible for their own duplicate-key handling and response
 * formatting/redaction, since the internal and external surfaces mask secrets
 * differently. The unique index on (team, service, name) guarantees duplicates
 * are rejected at write time regardless of any pre-flight check.
 */
export async function createWebhook(
  team: ObjectId | string,
  { name, service, url, description, queryParams, headers, body }: WebhookInput,
) {
  // Throws WebhookUrlValidationError on an invalid/blocked/mismatched URL.
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
 * Update (full replace) a webhook for a team.
 *
 * Shared by the External API v2 router and the MCP server. Encapsulates the
 * security-sensitive semantics so they live in exactly one place:
 *
 *   - Readable fields (description, body) are a full replace: present => set,
 *     omitted => cleared.
 *   - Write-only fields (headers, queryParams) are never returned on read, so
 *     a read-modify-write caller cannot re-send them. Omitting them PRESERVES
 *     the stored values; sending an explicit empty object ({}) clears them.
 *   - SECURITY: if the destination (url or service) changes, omitted write-only
 *     secrets are CLEARED rather than preserved, so stored auth headers are
 *     never silently forwarded to a newly-pointed destination.
 *   - The preserve/clear decision is computed from a non-atomic snapshot, so
 *     the write is pinned to the snapshotted url/service; a concurrent PUT that
 *     changed the destination in between yields a `conflict` result.
 *
 * Throws WebhookUrlValidationError on an invalid URL and surfaces duplicate-key
 * errors to the caller (the unique index on (team, service, name) enforces
 * uniqueness); callers map those to their own error responses.
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

  // Throws WebhookUrlValidationError on an invalid/blocked/mismatched URL.
  validateWebhookUrl({ service, url });

  const destinationChanged =
    url !== existing.url || service !== existing.service;

  // Readable fields are a full replace: present => keep, omitted => clear.
  // Write-only fields: omitted => preserve (unless the destination changed, in
  // which case clear so secrets are never forwarded to a new destination),
  // empty object => clear, present => set.
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

  // Pin the update to the snapshotted url/service so a concurrent PUT that
  // changed the destination in between cannot leave a secret configured for
  // one destination attached to a different url.
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
 * Delete a webhook for a team.
 *
 * Shared by the External API v2 router and the MCP server. Blocks deletion
 * while alerts still reference the webhook so we never orphan an alert onto a
 * missing destination (which would silently drop notifications).
 */
export async function deleteWebhook(
  team: ObjectId | string,
  webhookId: string,
): Promise<DeleteWebhookResult> {
  const alertCount = await Alert.countDocuments({
    'channel.type': 'webhook',
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
