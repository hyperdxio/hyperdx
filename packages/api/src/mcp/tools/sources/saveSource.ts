import { SourceSchemaNoId } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import * as config from '@/config';
import { createSource, getSource, updateSource } from '@/controllers/sources';
import type { ToolRegistrar } from '@/mcp/tools/types';
import {
  mcpServerError,
  mcpUserError,
  validateObjectId,
} from '@/mcp/utils/errors';
import { validateConnectionId } from '@/routers/external-api/v2/sources';
import { isDuplicateKeyError } from '@/utils/errors';

import { buildSourceInput, mcpSaveSourceSchema } from './schemas';

export function registerSaveSource({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId } = context;
  const frontendUrl = config.FRONTEND_URL;

  registerTool(
    'clickstack_save_source',
    {
      title: 'Create or Update Source',
      description:
        'Create a new data source (omit id) or update an existing one ' +
        '(provide id) so shipped telemetry becomes queryable. Update is a ' +
        'full replace of the source definition. Required for all kinds: kind, ' +
        'name, connection, databaseName, tableName, timestampValueExpression. ' +
        'Kind-specific requirements: log & trace need ' +
        'defaultTableSelectExpression; trace also needs durationExpression, ' +
        'traceIdExpression, spanIdExpression, parentSpanIdExpression, ' +
        'spanNameExpression, spanKindExpression; session needs traceSourceId; ' +
        'metric needs metricTables and resourceAttributesExpression. Get ' +
        'connection and source IDs from clickstack_list_sources.',
      inputSchema: mcpSaveSourceSchema,
    },
    async input => {
      // ── Validate ID for updates ──
      const sourceId = input.id;
      if (sourceId != null) {
        const idError = validateObjectId(sourceId, 'source ID');
        if (idError) return idError;
      }

      // ── Validate the connection is a real ObjectId owned by this team ──
      // createSource / updateSource / the internal router don't do this, so a
      // bad id would otherwise surface as a 500 CastError or reference another
      // team's credentials.
      const connectionCheck = await validateConnectionId(
        input.connection,
        new mongoose.Types.ObjectId(teamId),
      );
      if (!connectionCheck.ok) {
        return mcpUserError(connectionCheck.message);
      }

      // ── Assemble + validate against the canonical (per-kind) schema ──
      const assembled = buildSourceInput(input);
      const parsed = SourceSchemaNoId.safeParse(assembled);
      if (!parsed.success) {
        return mcpUserError(
          parsed.error.errors
            .map(e => `${e.path.join('.') || 'input'}: ${e.message}`)
            .join('; '),
        );
      }
      const sourceData = parsed.data as Parameters<typeof createSource>[1];

      // ── Validate correlated source IDs are owned by this team ──
      // Mirrors the connection ownership check: these fields link to other
      // sources by id, but SourceSchemaNoId only requires a non-empty string,
      // so without this a source could reference another team's source (or a
      // dangling id) and persist silently.
      const correlatedIdError = await validateCorrelatedSourceIds(
        teamId,
        parsed.data as Record<string, unknown>,
        sourceId,
      );
      if (correlatedIdError) {
        return mcpUserError(correlatedIdError);
      }

      try {
        // ── Update existing source ──
        if (sourceId != null) {
          const updated = await updateSource(teamId, sourceId, sourceData);
          if (!updated) {
            return mcpUserError('Source not found');
          }
          return sourceResult(updated, frontendUrl);
        }

        // ── Create new source ──
        const created = await createSource(teamId, sourceData);
        return sourceResult(created, frontendUrl);
      } catch (e) {
        // Bad input surfaces as a user error, not an alertable server error.
        // Mongoose ValidationError/CastError, a duplicate-key collision, and
        // updateSource's kind-change "Invalid source data" throw are all caused
        // by the caller's payload. Mirrors saveWebhook's error classification.
        const message = e instanceof Error ? e.message : String(e);
        if (
          e instanceof mongoose.Error.ValidationError ||
          e instanceof mongoose.Error.CastError ||
          isDuplicateKeyError(e) ||
          message.startsWith('Invalid source data')
        ) {
          return mcpUserError(message);
        }
        // Genuine server error: return a generic message rather than echoing
        // raw internal (ClickHouse/Mongoose) detail to the caller.
        return mcpServerError('Failed to save source');
      }
    },
  );
}

// Correlated-source fields that link one source to another by id. Present on a
// subset of kinds (validated by SourceSchemaNoId), so we probe each generically.
const CORRELATED_SOURCE_ID_FIELDS = [
  'logSourceId',
  'traceSourceId',
  'metricSourceId',
  'sessionSourceId',
] as const;

/**
 * Ensure every populated correlated-source id references a source owned by this
 * team. getSource is team-scoped and returns null for a non-ObjectId, a missing
 * id, or another team's source, so it doubles as the ownership check. Skips a
 * field that points at the source being updated (self-reference). Returns a
 * user-facing error string, or null when all references are valid.
 */
async function validateCorrelatedSourceIds(
  teamId: string,
  parsed: Record<string, unknown>,
  selfId: string | undefined,
): Promise<string | null> {
  for (const field of CORRELATED_SOURCE_ID_FIELDS) {
    const value = parsed[field];
    if (typeof value !== 'string' || value.length === 0) continue;
    if (selfId != null && value === selfId) continue;
    const referenced = await getSource(teamId, value);
    if (!referenced) {
      return `${field} must reference an existing source in this team`;
    }
  }
  return null;
}

function sourceResult(
  source: { toJSON(opts: { getters: boolean }): unknown } | null | undefined,
  frontendUrl: string | undefined,
) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            ...(source?.toJSON({ getters: true }) as Record<string, unknown>),
            ...(frontendUrl ? { url: `${frontendUrl}/team#sources` } : {}),
          },
          null,
          2,
        ),
      },
    ],
  };
}
