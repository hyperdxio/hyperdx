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
      const sourceId = input.id;
      if (sourceId != null) {
        const idError = validateObjectId(sourceId, 'source ID');
        if (idError) return idError;
      }

      // Reject a connection that isn't a valid ObjectId owned by this team
      // (createSource/updateSource don't check, so this avoids a 500 CastError
      // or a cross-team credential reference).
      const connectionCheck = await validateConnectionId(
        input.connection,
        new mongoose.Types.ObjectId(teamId),
      );
      if (!connectionCheck.ok) {
        return mcpUserError(connectionCheck.message);
      }

      // Re-validate against the canonical per-kind schema.
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

      const correlatedIdError = await validateCorrelatedSourceIds(
        teamId,
        parsed.data as Record<string, unknown>,
        sourceId,
      );
      if (correlatedIdError) {
        return mcpUserError(correlatedIdError);
      }

      try {
        if (sourceId != null) {
          const updated = await updateSource(teamId, sourceId, sourceData);
          if (!updated) {
            return mcpUserError('Source not found');
          }
          return sourceResult(updated, frontendUrl);
        }

        const created = await createSource(teamId, sourceData);
        return sourceResult(created, frontendUrl);
      } catch (e) {
        // Caller-payload errors (validation/cast/duplicate-key, and
        // updateSource's kind-change throw) are user errors; anything else is a
        // server error returned without leaking raw internal detail.
        const message = e instanceof Error ? e.message : String(e);
        if (
          e instanceof mongoose.Error.ValidationError ||
          e instanceof mongoose.Error.CastError ||
          isDuplicateKeyError(e) ||
          message.startsWith('Invalid source data')
        ) {
          return mcpUserError(message);
        }
        return mcpServerError('Failed to save source');
      }
    },
  );
}

const CORRELATED_SOURCE_ID_FIELDS = [
  'logSourceId',
  'traceSourceId',
  'metricSourceId',
  'sessionSourceId',
] as const;

/**
 * Reject a correlated-source id that doesn't reference a source owned by this
 * team (SourceSchemaNoId only checks it's a non-empty string). Returns a
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
