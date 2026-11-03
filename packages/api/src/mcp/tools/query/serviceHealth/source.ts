import { SourceKind } from '@hyperdx/common-utils/dist/types';

import { getSource, getSources } from '@/controllers/sources';
import type { McpErrorResult } from '@/mcp/utils/errors';
import { mcpUserError } from '@/mcp/utils/errors';

import type { HealthSource } from './queries';

const MAX_LISTED_SOURCES = 10;

/**
 * Agents often pass a table or source name where the ID belongs. Point them at
 * the exact ID when the input names one trace source, else list the options.
 */
async function sourceNotFound(
  teamId: string,
  sourceId: string,
  toolName: string,
): Promise<McpErrorResult> {
  const traces = (await getSources(teamId)).filter(
    s => s.kind === SourceKind.Trace,
  );
  const needle = sourceId.trim().toLowerCase();
  const describe = (s: (typeof traces)[number]) =>
    `${s._id.toString()} ("${s.name}", table ${s.from.databaseName}.${s.from.tableName})`;
  const matches = traces.filter(s =>
    [
      s.name,
      s.from.tableName,
      `${s.from.databaseName}.${s.from.tableName}`,
    ].some(v => v.toLowerCase() === needle),
  );
  // With several matches, naming one would be a guess; list them instead.
  const match = matches.length === 1 ? matches[0] : undefined;
  if (match) {
    return mcpUserError(
      `"${sourceId}" is a source name or table, not a source ID. Retry ${toolName} ` +
        `with sourceId:"${match._id.toString()}".`,
    );
  }
  const listed = traces.slice(0, MAX_LISTED_SOURCES).map(describe);
  return mcpUserError(
    `Source not found: "${sourceId}". sourceId must be the "id" field from ` +
      'clickstack_list_sources, not a name or table. ' +
      (listed.length
        ? `Trace sources: ${listed.join('; ')}.`
        : 'This team has no trace sources.'),
  );
}

/** Load a trace source and check it has the fields the tool needs. */
export async function loadHealthSource(
  teamId: string,
  sourceId: string,
  toolName: string,
): Promise<HealthSource | McpErrorResult> {
  const doc = await getSource(teamId, sourceId);
  if (!doc) return sourceNotFound(teamId, sourceId, toolName);
  if (doc.kind !== SourceKind.Trace) {
    return mcpUserError(
      `Source ${sourceId} is kind="${doc.kind}". ${toolName} requires a source of kind="trace".`,
    );
  }
  if (!doc.serviceNameExpression || !doc.statusCodeExpression) {
    return mcpUserError(
      `Source ${sourceId} has no ` +
        `${doc.serviceNameExpression ? 'statusCodeExpression' : 'serviceNameExpression'}. ` +
        'Set it with clickstack_save_source, then retry.',
    );
  }
  return {
    id: doc._id.toString(),
    connection: doc.connection.toString(),
    from: {
      databaseName: doc.from.databaseName,
      tableName: doc.from.tableName,
    },
    timestampValueExpression: doc.timestampValueExpression,
    implicitColumnExpression: doc.implicitColumnExpression,
    useTextIndexForImplicitColumn: doc.useTextIndexForImplicitColumn,
    sampleRateExpression: doc.sampleRateExpression,
    serviceNameExpression: doc.serviceNameExpression,
    statusCodeExpression: doc.statusCodeExpression,
    statusMessageExpression: doc.statusMessageExpression,
    spanNameExpression: doc.spanNameExpression,
    spanKindExpression: doc.spanKindExpression,
    durationExpression: doc.durationExpression,
    durationPrecision: doc.durationPrecision,
    metricSourceId: doc.metricSourceId,
    querySettings: doc.querySettings,
  };
}
