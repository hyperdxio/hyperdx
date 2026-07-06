import {
  SourceKind,
  SourceSchema,
  SourceSchemaNoId,
  type TSource,
} from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { z } from 'zod';

import {
  createSource,
  deleteSource,
  getSource,
  getSources,
  updateSource,
} from '@/controllers/sources';
import Connection from '@/models/connection';
import { SourceDocument } from '@/models/source';
import { processRequestWithEnhancedErrors as validateRequest } from '@/utils/enhancedErrors';
import logger from '@/utils/logger';
import { objectIdSchema } from '@/utils/zod';

export function mapGranularityToExternalFormat(granularity: string): string {
  const matches = granularity.match(/^(\d+) (second|minute|hour|day)$/);
  if (matches == null) return granularity;

  const [, amount, unit] = matches;
  switch (unit) {
    case 'second':
      return `${amount}s`;
    case 'minute':
      return `${amount}m`;
    case 'hour':
      return `${amount}h`;
    case 'day':
      return `${amount}d`;
    default:
      return granularity;
  }
}

export function mapGranularityToInternalFormat(granularity: string): string {
  const matches = granularity.match(/^(\d+)(s|m|h|d)$/);
  if (matches == null) return granularity;

  const [, amount, unit] = matches;
  switch (unit) {
    case 's':
      return `${amount} second`;
    case 'm':
      return `${amount} minute`;
    case 'h':
      return `${amount} hour`;
    case 'd':
      return `${amount} day`;
    default:
      return granularity;
  }
}

// Maps external short-form granularities (e.g. "5m") in the request body to
// the internal SQL interval format (e.g. "5 minute") expected by SourceSchema.
// Runs before body validation so external clients can use the same format the
// API returns.
function mapRequestGranularitiesToInternalFormat(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction,
) {
  const body = req.body;
  if (body != null && typeof body === 'object') {
    if (Array.isArray(body.materializedViews)) {
      for (const view of body.materializedViews) {
        if (view != null && typeof view.minGranularity === 'string') {
          view.minGranularity = mapGranularityToInternalFormat(
            view.minGranularity,
          );
        }
      }
    }
    if (
      body.metadataMaterializedViews != null &&
      typeof body.metadataMaterializedViews.granularity === 'string'
    ) {
      body.metadataMaterializedViews.granularity =
        mapGranularityToInternalFormat(
          body.metadataMaterializedViews.granularity,
        );
    }
  }
  next();
}

type ConnectionValidation =
  | { ok: true }
  | { ok: false; status: 400 | 403; message: string };

// Validates that `connection` is a valid ObjectId referencing a connection
// owned by the given team. SourceSchemaNoId only requires `connection` to be a
// non-empty string, but the Mongoose model declares it as an ObjectId ref — a
// non-ObjectId value would surface as a 500 CastError instead of a 400. The
// team-scoped existence check also ensures a source can never reference another
// team's ClickHouse credentials. Kept separate from the middleware so it's
// readable and unit-testable on its own.
export async function validateConnectionId(
  connection: unknown,
  teamId: Express.User['team'] | undefined,
): Promise<ConnectionValidation> {
  const parsed = objectIdSchema.safeParse(connection);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      message: 'connection must be a valid connection id',
    };
  }
  if (teamId == null) {
    return { ok: false, status: 403, message: 'Forbidden' };
  }
  const connectionExists = await Connection.exists({
    _id: parsed.data,
    team: teamId,
  });
  if (connectionExists == null) {
    return {
      ok: false,
      status: 400,
      message: 'connection must be an existing connection id',
    };
  }
  return { ok: true };
}

// Runs after body validation so req.body is the parsed shape.
async function requireValidConnectionId(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  try {
    const result = await validateConnectionId(
      req.body?.connection,
      req.user?.team,
    );
    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }
    next();
  } catch (e) {
    next(e);
  }
}

function mapSourceToExternalSource(source: TSource): TSource {
  if (!('materializedViews' in source)) return source;

  const mapped = { ...source };

  if (Array.isArray(source.materializedViews)) {
    mapped.materializedViews = source.materializedViews.map(view => ({
      ...view,
      minGranularity: mapGranularityToExternalFormat(view.minGranularity),
    }));
  }

  if (
    'metadataMaterializedViews' in source &&
    source.metadataMaterializedViews
  ) {
    mapped.metadataMaterializedViews = {
      ...source.metadataMaterializedViews,
      granularity: mapGranularityToExternalFormat(
        source.metadataMaterializedViews.granularity,
      ),
    };
  }

  return mapped;
}

function applyLegacyDefaults(
  parsed: Record<string, unknown>,
): Record<string, unknown> {
  // Legacy Session sources were created before timestampValueExpression was
  // required. The old code defaulted it to 'TimestampTime' at query time.
  if (parsed.kind === SourceKind.Session && !parsed.timestampValueExpression) {
    return { ...parsed, timestampValueExpression: 'TimestampTime' };
  }
  return parsed;
}

function formatExternalSource(source: SourceDocument) {
  // Convert to JSON so that any ObjectIds are converted to strings
  const json = JSON.stringify(
    (() => {
      switch (source.kind) {
        case SourceKind.Log:
          return source.toJSON({ getters: true });
        case SourceKind.Trace:
          return source.toJSON({ getters: true });
        case SourceKind.Metric:
          return source.toJSON({ getters: true });
        case SourceKind.Session:
          return source.toJSON({ getters: true });
        case SourceKind.Promql:
          return source.toJSON({ getters: true });
        default:
          source satisfies never;
          return {};
      }
    })(),
  );

  // Parse using the SourceSchema to strip out any fields not defined in the schema
  const parseResult = SourceSchema.safeParse(
    applyLegacyDefaults(JSON.parse(json)),
  );
  if (parseResult.success) {
    return mapSourceToExternalSource(parseResult.data);
  }

  // If parsing fails, log the error and return undefined
  logger.error(
    { source, error: parseResult.error },
    'Failed to parse source using SourceSchema:',
  );

  return undefined;
}

/**
 * @openapi
 * components:
 *   schemas:
 *     QuerySetting:
 *       type: object
 *       required:
 *         - setting
 *         - value
 *       properties:
 *         setting:
 *           type: string
 *           description: ClickHouse setting name
 *           example: max_threads
 *         value:
 *           type: string
 *           description: Setting value
 *           example: "4"
 *     SourceFrom:
 *       type: object
 *       required:
 *         - databaseName
 *         - tableName
 *       properties:
 *         databaseName:
 *           type: string
 *           description: ClickHouse database name
 *           example: otel
 *         tableName:
 *           type: string
 *           description: ClickHouse table name
 *           example: otel_logs
 *     MetricSourceFrom:
 *       type: object
 *       required:
 *         - databaseName
 *       properties:
 *         databaseName:
 *           type: string
 *           description: ClickHouse database name
 *           example: otel
 *         tableName:
 *           type: string
 *           description: ClickHouse table name
 *           nullable: true
 *           example: otel_metrics_gauge
 *     MetricTables:
 *       type: object
 *       description: Mapping of metric data types to table names. At least one must be specified.
 *       properties:
 *         gauge:
 *           type: string
 *           description: Table containing gauge metrics data
 *           example: otel_metrics_gauge
 *         histogram:
 *           type: string
 *           description: Table containing histogram metrics data
 *           example: otel_metrics_histogram
 *         sum:
 *           type: string
 *           description: Table containing sum metrics data
 *           example: otel_metrics_sum
 *         summary:
 *           type: string
 *           description: Table containing summary metrics data. Note - not yet fully supported by HyperDX
 *           example: otel_metrics_summary
 *         exponential histogram:
 *           type: string
 *           description: Table containing exponential histogram metrics data. Note - not yet fully supported by HyperDX
 *           example: otel_metrics_exponential_histogram
 *     HighlightedAttributeExpression:
 *       type: object
 *       required:
 *         - sqlExpression
 *       properties:
 *         sqlExpression:
 *           type: string
 *           description: SQL expression for the attribute
 *           example: SpanAttributes['http.status_code']
 *         luceneExpression:
 *           type: string
 *           description: An optional, Lucene version of the sqlExpression expression. If provided, it is used when searching for this attribute value.
 *           nullable: true
 *           example: http.status_code
 *         alias:
 *           type: string
 *           description: Optional alias for the attribute
 *           nullable: true
 *           example: HTTP Status Code
 *     AggregatedColumn:
 *       type: object
 *       required:
 *         - mvColumn
 *         - aggFn
 *       properties:
 *         sourceColumn:
 *           type: string
 *           description: Source column name
 *           nullable: true
 *           example: Duration
 *         aggFn:
 *           type: string
 *           description: Aggregation function (e.g., count, sum, avg)
 *           example: sum
 *         mvColumn:
 *           type: string
 *           description: Materialized view column name
 *           example: sum__Duration
 *     MaterializedView:
 *       type: object
 *       required:
 *         - databaseName
 *         - tableName
 *         - dimensionColumns
 *         - minGranularity
 *         - timestampColumn
 *         - aggregatedColumns
 *       properties:
 *         databaseName:
 *           type: string
 *           description: Database name for the materialized view
 *           example: otel
 *         tableName:
 *           type: string
 *           description: Table name for the materialized view
 *           example: otel_logs_mv_5m
 *         dimensionColumns:
 *           type: string
 *           description: Columns which are not pre-aggregated in the materialized view and can be used for filtering and grouping.
 *           example: ServiceName, SeverityText
 *         minGranularity:
 *           type: string
 *           description: "The granularity of the timestamp column: a positive integer followed by a unit (s, m, h, d). Common values: 1s, 15s, 30s, 1m, 5m, 15m, 30m, 1h, 2h, 6h, 12h, 1d, 2d, 7d, 30d."
 *           pattern: '^\d+(s|m|h|d)$'
 *           example: 5m
 *         minDate:
 *           type: string
 *           format: date-time
 *           description: (Optional) The earliest date and time for which the materialized view contains data. If not provided, then HyperDX will assume that the materialized view contains data for all dates for which the source table contains data.
 *           nullable: true
 *           example: "2025-01-01T00:00:00Z"
 *         timestampColumn:
 *           type: string
 *           description: Timestamp column name
 *           example: Timestamp
 *         aggregatedColumns:
 *           type: array
 *           description: Columns which are pre-aggregated by the materialized view
 *           items:
 *             $ref: '#/components/schemas/AggregatedColumn'
 *     LogSource:
 *       type: object
 *       required:
 *         - name
 *         - kind
 *         - connection
 *         - from
 *         - defaultTableSelectExpression
 *         - timestampValueExpression
 *       properties:
 *         id:
 *           type: string
 *           readOnly: true
 *           description: Unique source ID. Server-generated; ignored if sent in create/update requests.
 *           example: 507f1f77bcf86cd799439011
 *         name:
 *           type: string
 *           description: Display name for the source.
 *           example: Logs
 *         section:
 *           type: string
 *           maxLength: 256
 *           description: Optional grouping label used to organize sources in the source selector. Sources that share a section value are displayed together.
 *           example: Billing
 *         disabled:
 *           type: boolean
 *           description: When true, the source is hidden from source selectors in the UI. Defaults to false.
 *           nullable: true
 *           example: false
 *         kind:
 *           type: string
 *           enum: [log]
 *           description: Source kind discriminator. Must be "log" for log sources.
 *           example: log
 *         connection:
 *           type: string
 *           description: ID of the ClickHouse connection used by this source.
 *           example: 507f1f77bcf86cd799439012
 *         from:
 *           $ref: '#/components/schemas/SourceFrom'
 *           description: Database and table location of the source data.
 *         querySettings:
 *           type: array
 *           description: Optional ClickHouse query settings applied when querying this source.
 *           items:
 *             $ref: '#/components/schemas/QuerySetting'
 *           nullable: true
 *         defaultTableSelectExpression:
 *           type: string
 *           description: Default columns selected in search results (this can be customized per search later)
 *           example: Timestamp, ServiceName, SeverityText, Body
 *         timestampValueExpression:
 *           type: string
 *           description: DateTime column or expression that is part of your table's primary key.
 *           example: Timestamp
 *         serviceNameExpression:
 *           type: string
 *           description: Expression to extract the service name from log rows.
 *           nullable: true
 *           example: ServiceName
 *         severityTextExpression:
 *           type: string
 *           description: Expression to extract the severity/log level text.
 *           nullable: true
 *           example: SeverityText
 *         bodyExpression:
 *           type: string
 *           description: Expression to extract the log message body.
 *           nullable: true
 *           example: Body
 *         eventAttributesExpression:
 *           type: string
 *           description: Expression to extract event-level attributes.
 *           nullable: true
 *           example: LogAttributes
 *         resourceAttributesExpression:
 *           type: string
 *           description: Expression to extract resource-level attributes.
 *           nullable: true
 *           example: ResourceAttributes
 *         displayedTimestampValueExpression:
 *           type: string
 *           description: This DateTime column is used to display and order search results.
 *           nullable: true
 *           example: TimestampTime
 *         metricSourceId:
 *           type: string
 *           description: HyperDX Source for metrics associated with logs. Optional
 *           nullable: true
 *           example: 507f1f77bcf86cd799439013
 *         traceSourceId:
 *           type: string
 *           description: HyperDX Source for traces associated with logs. Optional
 *           nullable: true
 *           example: 507f1f77bcf86cd799439014
 *         traceIdExpression:
 *           type: string
 *           description: Expression to extract the trace ID for correlating logs with traces.
 *           nullable: true
 *           example: TraceId
 *         spanIdExpression:
 *           type: string
 *           description: Expression to extract the span ID for correlating logs with traces.
 *           nullable: true
 *           example: SpanId
 *         implicitColumnExpression:
 *           type: string
 *           description: Column used for full text search if no property is specified in a Lucene-based search. Typically the message body of a log.
 *           nullable: true
 *           example: Body
 *         knownColumnsListExpression:
 *           type: string
 *           description: For Distributed table sources whose target tables have non-matching column sets. A list of columns supported across all target tables, used instead of SELECT * when fetching full row data. Leave blank to select all columns.
 *           nullable: true
 *           example: Timestamp, Body, ServiceName
 *         useTextIndexForImplicitColumn:
 *           type: string
 *           enum: [auto, enabled, disabled]
 *           description: Controls whether lucene rendering uses ClickHouse text indices via hasAllTokens() against the implicit column. "auto" detects a covering index at query time, "enabled" forces text index usage, "disabled" forces a LIKE/hasToken fallback.
 *           nullable: true
 *           example: auto
 *         highlightedTraceAttributeExpressions:
 *           type: array
 *           description: Expressions defining trace-level attributes which are displayed in the trace view for the selected trace.
 *           items:
 *             $ref: '#/components/schemas/HighlightedAttributeExpression'
 *           nullable: true
 *         highlightedRowAttributeExpressions:
 *           type: array
 *           description: Expressions defining row-level attributes which are displayed in the row side panel for the selected row.
 *           items:
 *             $ref: '#/components/schemas/HighlightedAttributeExpression'
 *           nullable: true
 *         materializedViews:
 *           type: array
 *           description: Configure materialized views for query optimization. These pre-aggregated views can significantly improve query performance on aggregation queries.
 *           items:
 *             $ref: '#/components/schemas/MaterializedView'
 *           nullable: true
 *         metadataMaterializedViews:
 *           type: object
 *           description: Configure materialized views for fast field discovery and value autocomplete.
 *           nullable: true
 *           properties:
 *             keyRollupTable:
 *               type: string
 *               description: ClickHouse table name for the key rollup (field discovery).
 *               example: otel_logs_key_rollup_15m
 *             kvRollupTable:
 *               type: string
 *               description: ClickHouse table name for the key-value rollup (value autocomplete).
 *               example: otel_logs_kv_rollup_15m
 *             granularity:
 *               type: string
 *               description: The time granularity of the rollup tables.
 *               example: 15m
 *     TraceSource:
 *       type: object
 *       required:
 *         - name
 *         - kind
 *         - connection
 *         - from
 *         - defaultTableSelectExpression
 *         - timestampValueExpression
 *         - durationExpression
 *         - durationPrecision
 *         - traceIdExpression
 *         - spanIdExpression
 *         - parentSpanIdExpression
 *         - spanNameExpression
 *         - spanKindExpression
 *       properties:
 *         id:
 *           type: string
 *           readOnly: true
 *           description: Unique source ID. Server-generated; ignored if sent in create/update requests.
 *           example: 507f1f77bcf86cd799439021
 *         name:
 *           type: string
 *           description: Display name for the source.
 *           example: Traces
 *         section:
 *           type: string
 *           maxLength: 256
 *           description: Optional grouping label used to organize sources in the source selector. Sources that share a section value are displayed together.
 *           example: Billing
 *         disabled:
 *           type: boolean
 *           description: When true, the source is hidden from source selectors in the UI. Defaults to false.
 *           nullable: true
 *           example: false
 *         kind:
 *           type: string
 *           enum: [trace]
 *           description: Source kind discriminator. Must be "trace" for trace sources.
 *           example: trace
 *         connection:
 *           type: string
 *           description: ID of the ClickHouse connection used by this source.
 *           example: 507f1f77bcf86cd799439012
 *         from:
 *           $ref: '#/components/schemas/SourceFrom'
 *           description: Database and table location of the source data.
 *         querySettings:
 *           type: array
 *           description: Optional ClickHouse query settings applied when querying this source.
 *           items:
 *             $ref: '#/components/schemas/QuerySetting'
 *           nullable: true
 *         defaultTableSelectExpression:
 *           type: string
 *           description: Default columns selected in search results (this can be customized per search later)
 *           example: Timestamp, SpanName, ServiceName, Duration
 *         timestampValueExpression:
 *           type: string
 *           description: DateTime column or expression defines the start of the span
 *           example: Timestamp
 *         durationExpression:
 *           type: string
 *           description: Expression to extract span duration.
 *           example: Duration
 *         durationPrecision:
 *           type: integer
 *           minimum: 0
 *           maximum: 9
 *           default: 3
 *           description: Number of decimal digits in the duration value (e.g., 3 for milliseconds, 6 for microseconds, 9 for nanoseconds).
 *         traceIdExpression:
 *           type: string
 *           description: Expression to extract the trace ID.
 *           example: TraceId
 *         spanIdExpression:
 *           type: string
 *           description: Expression to extract the span ID.
 *           example: SpanId
 *         parentSpanIdExpression:
 *           type: string
 *           description: Expression to extract the parent span ID.
 *           example: ParentSpanId
 *         spanNameExpression:
 *           type: string
 *           description: Expression to extract the span name.
 *           example: SpanName
 *         spanKindExpression:
 *           type: string
 *           description: Expression to extract the span kind (e.g., client, server, internal).
 *           example: SpanKind
 *         logSourceId:
 *           type: string
 *           description: HyperDX Source for logs associated with traces. Optional
 *           nullable: true
 *           example: 507f1f77bcf86cd799439011
 *         sessionSourceId:
 *           type: string
 *           description: HyperDX Source for sessions associated with traces. Optional
 *           nullable: true
 *           example: 507f1f77bcf86cd799439031
 *         metricSourceId:
 *           type: string
 *           description: HyperDX Source for metrics associated with traces. Optional
 *           nullable: true
 *           example: 507f1f77bcf86cd799439041
 *         statusCodeExpression:
 *           type: string
 *           description: Expression to extract the span status code.
 *           nullable: true
 *           example: StatusCode
 *         statusMessageExpression:
 *           type: string
 *           description: Expression to extract the span status message.
 *           nullable: true
 *           example: StatusMessage
 *         serviceNameExpression:
 *           type: string
 *           description: Expression to extract the service name from trace rows.
 *           nullable: true
 *           example: ServiceName
 *         resourceAttributesExpression:
 *           type: string
 *           description: Expression to extract resource-level attributes.
 *           nullable: true
 *           example: ResourceAttributes
 *         eventAttributesExpression:
 *           type: string
 *           description: Expression to extract event-level attributes.
 *           nullable: true
 *           example: SpanAttributes
 *         spanEventsValueExpression:
 *           type: string
 *           description: Expression to extract span events. Used to capture events associated with spans. Expected to be Nested ( Timestamp DateTime64(9), Name LowCardinality(String), Attributes Map(LowCardinality(String), String)
 *           nullable: true
 *           example: Events
 *         implicitColumnExpression:
 *           type: string
 *           description: Column used for full text search if no property is specified in a Lucene-based search. Typically the message body of a log.
 *           nullable: true
 *           example: SpanName
 *         knownColumnsListExpression:
 *           type: string
 *           description: For Distributed table sources whose target tables have non-matching column sets. A list of columns supported across all target tables, used instead of SELECT * when fetching full row data. Leave blank to select all columns.
 *           nullable: true
 *           example: Timestamp, Body, ServiceName
 *         useTextIndexForImplicitColumn:
 *           type: string
 *           enum: [auto, enabled, disabled]
 *           description: Controls whether lucene rendering uses ClickHouse text indices via hasAllTokens() against the implicit column. "auto" detects a covering index at query time, "enabled" forces text index usage, "disabled" forces a LIKE/hasToken fallback.
 *           nullable: true
 *           example: auto
 *         highlightedTraceAttributeExpressions:
 *           type: array
 *           description: Expressions defining trace-level attributes which are displayed in the trace view for the selected trace.
 *           items:
 *             $ref: '#/components/schemas/HighlightedAttributeExpression'
 *           nullable: true
 *         highlightedRowAttributeExpressions:
 *           type: array
 *           description: Expressions defining row-level attributes which are displayed in the row side panel for the selected row
 *           items:
 *             $ref: '#/components/schemas/HighlightedAttributeExpression'
 *           nullable: true
 *         materializedViews:
 *           type: array
 *           description: Configure materialized views for query optimization. These pre-aggregated views can significantly improve query performance on aggregation queries.
 *           items:
 *             $ref: '#/components/schemas/MaterializedView'
 *           nullable: true
 *         metadataMaterializedViews:
 *           type: object
 *           description: Configure materialized views for fast field discovery and value autocomplete.
 *           nullable: true
 *           properties:
 *             keyRollupTable:
 *               type: string
 *               description: ClickHouse table name for the key rollup (field discovery).
 *               example: otel_traces_key_rollup_15m
 *             kvRollupTable:
 *               type: string
 *               description: ClickHouse table name for the key-value rollup (value autocomplete).
 *               example: otel_traces_kv_rollup_15m
 *             granularity:
 *               type: string
 *               description: The time granularity of the rollup tables.
 *               example: 15m
 *     MetricSource:
 *       type: object
 *       required:
 *         - name
 *         - kind
 *         - connection
 *         - from
 *         - metricTables
 *         - timestampValueExpression
 *         - resourceAttributesExpression
 *       properties:
 *         id:
 *           type: string
 *           readOnly: true
 *           description: Unique source ID. Server-generated; ignored if sent in create/update requests.
 *           example: 507f1f77bcf86cd799439041
 *         name:
 *           type: string
 *           description: Display name for the source.
 *           example: Metrics
 *         section:
 *           type: string
 *           maxLength: 256
 *           description: Optional grouping label used to organize sources in the source selector. Sources that share a section value are displayed together.
 *           example: Billing
 *         disabled:
 *           type: boolean
 *           description: When true, the source is hidden from source selectors in the UI. Defaults to false.
 *           nullable: true
 *           example: false
 *         kind:
 *           type: string
 *           enum: [metric]
 *           description: Source kind discriminator. Must be "metric" for metric sources.
 *           example: metric
 *         connection:
 *           type: string
 *           description: ID of the ClickHouse connection used by this source.
 *           example: 507f1f77bcf86cd799439012
 *         from:
 *           $ref: '#/components/schemas/MetricSourceFrom'
 *           description: Database and optional table location of the metric source data.
 *         querySettings:
 *           type: array
 *           description: Optional ClickHouse query settings applied when querying this source.
 *           items:
 *             $ref: '#/components/schemas/QuerySetting'
 *           nullable: true
 *         metricTables:
 *           $ref: '#/components/schemas/MetricTables'
 *           description: Mapping of metric data types to their respective table names.
 *         timestampValueExpression:
 *           type: string
 *           description: DateTime column or expression that is part of your table's primary key.
 *           example: TimeUnix
 *         resourceAttributesExpression:
 *           type: string
 *           description: Column containing resource attributes for metrics
 *           example: ResourceAttributes
 *         logSourceId:
 *           type: string
 *           description: HyperDX Source for logs associated with metrics. Optional
 *           nullable: true
 *           example: 507f1f77bcf86cd799439011
 *     SessionSource:
 *       type: object
 *       required:
 *         - name
 *         - kind
 *         - connection
 *         - from
 *         - traceSourceId
 *       properties:
 *         id:
 *           type: string
 *           readOnly: true
 *           description: Unique source ID. Server-generated; ignored if sent in create/update requests.
 *           example: 507f1f77bcf86cd799439031
 *         name:
 *           type: string
 *           description: Display name for the source.
 *           example: Sessions
 *         section:
 *           type: string
 *           maxLength: 256
 *           description: Optional grouping label used to organize sources in the source selector. Sources that share a section value are displayed together.
 *           example: Billing
 *         disabled:
 *           type: boolean
 *           description: When true, the source is hidden from source selectors in the UI. Defaults to false.
 *           nullable: true
 *           example: false
 *         kind:
 *           type: string
 *           enum: [session]
 *           description: Source kind discriminator. Must be "session" for session sources.
 *           example: session
 *         connection:
 *           type: string
 *           description: ID of the ClickHouse connection used by this source.
 *           example: 507f1f77bcf86cd799439012
 *         from:
 *           $ref: '#/components/schemas/SourceFrom'
 *           description: Database and table location of the source data.
 *         querySettings:
 *           type: array
 *           description: Optional ClickHouse query settings applied when querying this source.
 *           items:
 *             $ref: '#/components/schemas/QuerySetting'
 *           nullable: true
 *         timestampValueExpression:
 *           type: string
 *           description: DateTime column or expression that is part of your table's primary key.
 *           nullable: true
 *           example: TimestampTime
 *         traceSourceId:
 *           type: string
 *           description: HyperDX Source for traces associated with sessions.
 *           example: 507f1f77bcf86cd799439021
 *     PromqlSource:
 *       type: object
 *       description: A source backed by a Prometheus-compatible endpoint, queried with PromQL. The referenced connection should be a Prometheus connection (isPrometheusEndpoint set to true).
 *       required:
 *         - name
 *         - kind
 *         - connection
 *         - from
 *         - timestampValueExpression
 *       properties:
 *         id:
 *           type: string
 *           readOnly: true
 *           description: Unique source ID. Server-generated; ignored if sent in create/update requests.
 *           example: 507f1f77bcf86cd799439051
 *         name:
 *           type: string
 *           description: Display name for the source.
 *           example: Prometheus Metrics
 *         section:
 *           type: string
 *           maxLength: 256
 *           description: Optional grouping label used to organize sources in the source selector. Sources that share a section value are displayed together.
 *           example: Billing
 *         disabled:
 *           type: boolean
 *           description: When true, the source is hidden from source selectors in the UI. Defaults to false.
 *           nullable: true
 *           example: false
 *         kind:
 *           type: string
 *           enum: [promql]
 *           description: Source kind discriminator. Must be "promql" for PromQL sources.
 *           example: promql
 *         connection:
 *           type: string
 *           description: ID of the connection used by this source. Should reference a Prometheus-compatible connection.
 *           example: 507f1f77bcf86cd799439012
 *         from:
 *           $ref: '#/components/schemas/SourceFrom'
 *           description: Required by the API for all source kinds; not used when querying a Prometheus endpoint (empty strings are not accepted — use placeholder values such as "default").
 *         querySettings:
 *           type: array
 *           description: Optional ClickHouse query settings applied when querying this source.
 *           items:
 *             $ref: '#/components/schemas/QuerySetting'
 *           nullable: true
 *         timestampValueExpression:
 *           type: string
 *           description: Required by the API for all source kinds; not used when querying a Prometheus endpoint.
 *           example: timestamp
 *     Source:
 *       oneOf:
 *         - $ref: '#/components/schemas/LogSource'
 *         - $ref: '#/components/schemas/TraceSource'
 *         - $ref: '#/components/schemas/MetricSource'
 *         - $ref: '#/components/schemas/SessionSource'
 *         - $ref: '#/components/schemas/PromqlSource'
 *       discriminator:
 *         propertyName: kind
 *         mapping:
 *           log: '#/components/schemas/LogSource'
 *           trace: '#/components/schemas/TraceSource'
 *           metric: '#/components/schemas/MetricSource'
 *           session: '#/components/schemas/SessionSource'
 *           promql: '#/components/schemas/PromqlSource'
 *     SourcesListResponse:
 *       type: object
 *       properties:
 *         data:
 *           type: array
 *           description: List of source objects.
 *           items:
 *             $ref: '#/components/schemas/Source'
 *     SourceResponseEnvelope:
 *       type: object
 *       properties:
 *         data:
 *           $ref: '#/components/schemas/Source'
 *           description: The source object.
 */

const router = express.Router();

/**
 * @openapi
 * /api/v2/sources:
 *   get:
 *     summary: List Sources
 *     description: Retrieves a list of all sources for the authenticated team
 *     operationId: listSources
 *     tags: [Sources]
 *     responses:
 *       '200':
 *         description: Successfully retrieved sources
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SourcesListResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Unauthorized access. API key is missing or invalid."
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const sources: SourceDocument[] = await getSources(teamId.toString());

    return res.json({
      data: sources.map(formatExternalSource).filter(s => s !== undefined),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/v2/sources/{id}:
 *   get:
 *     summary: Get Source
 *     description: Retrieves a specific source by ID
 *     operationId: getSource
 *     tags: [Sources]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Source ID
 *         example: "507f1f77bcf86cd799439011"
 *     responses:
 *       '200':
 *         description: Successfully retrieved source
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SourceResponseEnvelope'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Unauthorized access. API key is missing or invalid."
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Source not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Source not found"
 */
router.get(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      const source = await getSource(teamId.toString(), req.params.id);

      if (source == null) {
        return res.status(404).json({ message: 'Source not found' });
      }

      const data = formatExternalSource(source);
      if (data === undefined) {
        throw new Error(
          `Failed to serialize source ${source._id} for external API`,
        );
      }

      res.json({ data });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/v2/sources:
 *   post:
 *     summary: Create Source
 *     description: |
 *       Creates a new source.
 *
 *       The request body is a source object without the `id` field. If an
 *       `id` is sent anyway it is silently ignored (stripped before
 *       validation — the request is never rejected because of it).
 *       Granularity fields
 *       (`materializedViews[].minGranularity` and
 *       `metadataMaterializedViews.granularity`) accept the same short format
 *       the API returns (e.g. `5m`, `15s`, `1h`, `1d`).
 *     operationId: createSource
 *     tags: [Sources]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Source'
 *     responses:
 *       '200':
 *         description: Successfully created source
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SourceResponseEnvelope'
 *       '400':
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Body validation failed: name: Required"
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Unauthorized access. API key is missing or invalid."
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post(
  '/',
  mapRequestGranularitiesToInternalFormat,
  validateRequest({
    body: SourceSchemaNoId,
  }),
  requireValidConnectionId,
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      const source = await createSource(teamId.toString(), {
        ...req.body,
        team: teamId.toJSON(),
      });

      const data = formatExternalSource(source);
      if (data === undefined) {
        throw new Error(
          `Failed to serialize source ${source._id} for external API`,
        );
      }

      res.json({ data });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/v2/sources/{id}:
 *   put:
 *     summary: Update Source
 *     description: |
 *       Updates an existing source. The full source object must be provided;
 *       this is a replace, not a patch.
 *
 *       The request body is a source object without the `id` field. If an
 *       `id` is sent anyway it is silently ignored (stripped before
 *       validation — never a 400); the path parameter alone identifies the
 *       source. Granularity fields (`materializedViews[].minGranularity` and
 *       `metadataMaterializedViews.granularity`) accept the same short format
 *       the API returns (e.g. `5m`, `15s`, `1h`, `1d`).
 *     operationId: updateSource
 *     tags: [Sources]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Source ID
 *         example: "507f1f77bcf86cd799439011"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Source'
 *     responses:
 *       '200':
 *         description: Successfully updated source
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SourceResponseEnvelope'
 *       '400':
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Body validation failed: name: Required"
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Unauthorized access. API key is missing or invalid."
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Source not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Source not found"
 */
router.put(
  '/:id',
  mapRequestGranularitiesToInternalFormat,
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    body: SourceSchemaNoId,
  }),
  requireValidConnectionId,
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      const source = await updateSource(teamId.toString(), req.params.id, {
        ...req.body,
        team: teamId.toJSON(),
      });

      if (source == null) {
        return res.status(404).json({ message: 'Source not found' });
      }

      const data = formatExternalSource(source);
      if (data === undefined) {
        throw new Error(
          `Failed to serialize source ${source._id} for external API`,
        );
      }

      res.json({ data });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/v2/sources/{id}:
 *   delete:
 *     summary: Delete Source
 *     description: Deletes a source
 *     operationId: deleteSource
 *     tags: [Sources]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Source ID
 *         example: "507f1f77bcf86cd799439011"
 *     responses:
 *       '200':
 *         description: Successfully deleted source
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmptyResponse'
 *             example: {}
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Unauthorized access. API key is missing or invalid."
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Source not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Source not found"
 */
router.delete(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      const deletedSource = await deleteSource(
        teamId.toString(),
        req.params.id,
      );

      if (deletedSource == null) {
        return res.status(404).json({ message: 'Source not found' });
      }

      res.json({});
    } catch (e) {
      next(e);
    }
  },
);

export default router;
