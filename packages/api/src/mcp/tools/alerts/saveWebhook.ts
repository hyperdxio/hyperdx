import { WebhookService } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';
import { z } from 'zod';

import { createWebhook, updateWebhook } from '@/controllers/webhook';
import type { ToolRegistrar } from '@/mcp/tools/types';
import {
  mcpServerError,
  mcpUserError,
  validateObjectId,
} from '@/mcp/utils/errors';
import { isDuplicateKeyError } from '@/utils/errors';
import { WebhookUrlValidationError } from '@/utils/validators';
import { externalWebhookCreateSchema } from '@/utils/zod';

// ---------------------------------------------------------------------------
// MCP-compatible flat Zod schema for clickstack_save_webhook.
//
// The canonical externalWebhookCreateSchema uses .superRefine() (a ZodEffects),
// which the MCP SDK's normalizeObjectSchema() cannot serialize.  We expose a
// plain z.object() here and re-validate the assembled input at runtime against
// externalWebhookCreateSchema so the per-service field rules and length/charset
// caps stay in exactly one place.
// ---------------------------------------------------------------------------
// Declared as plain string literals (not WebhookService enum members) so
// z.enum(...) narrows correctly at the MCP SDK callback boundary — referencing
// the enum directly pessimises Zod's inference to `unknown` across the
// surrounding optional fields (see mcp/tools/sources/metricKinds.ts for the
// same pattern). The compile-time assertion keeps the literals in sync with
// WebhookService so a new service cannot be added in only one place.
const WEBHOOK_SERVICES = ['slack', 'generic', 'incidentio'] as const;
const _assertWebhookServicesMatchEnum: readonly (typeof WEBHOOK_SERVICES)[number][] =
  [WebhookService.Slack, WebhookService.Generic, WebhookService.IncidentIO];
void _assertWebhookServicesMatchEnum;

const mcpSaveWebhookSchema = z.object({
  id: z
    .string()
    .optional()
    .describe(
      'Webhook ID. Omit to create a new webhook, provide to update an existing one.',
    ),
  name: z.string().min(1).describe('Human-friendly webhook name.'),
  service: z
    .enum(WEBHOOK_SERVICES)
    .describe(
      'Webhook service type. "slack" posts a fixed Block Kit payload and does ' +
        'not support headers/queryParams/body.',
    ),
  url: z
    .string()
    .describe(
      'Destination URL. For the slack service the host must end in slack.com. ' +
        'Private/reserved IPs and internal hosts are rejected.',
    ),
  description: z
    .string()
    .optional()
    .describe(
      'Optional description shown in the UI. On update this is a full replace: ' +
        'omitting it clears the stored description.',
    ),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Optional HTTP headers (key -> value). Not supported for the slack ' +
        'service. On update these are write-only: omitting them PRESERVES the ' +
        'stored values; send an empty object ({}) to clear them. If the ' +
        'destination (url or service) changes, omitted headers are cleared.',
    ),
  queryParams: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Optional query parameters (key -> value). Not supported for the slack ' +
        'service. Same write-only update semantics as headers.',
    ),
  body: z
    .string()
    .optional()
    .describe(
      'Optional request body template. Not supported for the slack service. ' +
        'On update this is a full replace: omitting it clears the stored body.',
    ),
});

export function registerSaveWebhook({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId } = context;

  registerTool(
    'clickstack_save_webhook',
    {
      title: 'Create or Update Webhook',
      description:
        'Create a new webhook (omit id) or update an existing one (provide ' +
        'id). Use the returned id as the webhookId when creating alerts with ' +
        'clickstack_save_alert. Required: name, service (slack, generic, or ' +
        'incidentio), and url. For the slack service the url host must end in ' +
        'slack.com and headers/queryParams/body are not supported. On update, ' +
        'readable fields (description, body) are a full replace while ' +
        'write-only headers/queryParams are preserved when omitted (send {} to ' +
        'clear); changing the destination clears omitted write-only secrets.',
      inputSchema: mcpSaveWebhookSchema,
    },
    async input => {
      // ── Validate ID for updates ──
      const webhookId = input.id;
      if (webhookId != null) {
        const idError = validateObjectId(webhookId, 'webhook ID');
        if (idError) return idError;
      }

      // ── Re-validate against the canonical schema (superRefine + caps) ──
      const { id: _id, ...webhookFields } = input;
      const parsed = externalWebhookCreateSchema.safeParse(webhookFields);
      if (!parsed.success) {
        return mcpUserError(
          parsed.error.errors
            .map(e => `${e.path.join('.') || 'input'}: ${e.message}`)
            .join('; '),
        );
      }

      const mongoTeamId = new mongoose.Types.ObjectId(teamId);

      try {
        // ── Update existing webhook ──
        if (webhookId != null) {
          const result = await updateWebhook(
            mongoTeamId,
            webhookId,
            parsed.data,
          );
          if (result.status === 'not_found') {
            return mcpUserError('Webhook not found');
          }
          if (result.status === 'conflict') {
            return mcpUserError(
              'Webhook was modified concurrently; please retry with the current state',
            );
          }
          return webhookResult(result.webhook);
        }

        // ── Create new webhook ──
        const webhook = await createWebhook(mongoTeamId, parsed.data);
        return webhookResult(webhook);
      } catch (e) {
        if (e instanceof WebhookUrlValidationError) {
          return mcpUserError(e.message);
        }
        if (isDuplicateKeyError(e)) {
          return mcpUserError(
            'A webhook with this service and name already exists',
          );
        }
        return mcpServerError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}

// Mirror clickstack_get_webhook's write-only posture: never echo the
// url/headers/queryParams (they may embed secrets).
function webhookResult(webhook: {
  _id: { toString(): string };
  name: string;
  service: string;
}) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: webhook._id.toString(),
            name: webhook.name,
            service: webhook.service,
          },
          null,
          2,
        ),
      },
    ],
  };
}
