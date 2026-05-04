import {
  SourceKind,
  SourceSchema,
  type TSource,
} from '@hyperdx/common-utils/dist/types';
import express from 'express';

import { getSources } from '@/controllers/sources';
import { SourceDocument } from '@/models/source';
import logger from '@/utils/logger';

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

function mapSourceToExternalSource(source: TSource): TSource {
  if (!('materializedViews' in source)) return source;
  if (!Array.isArray(source.materializedViews)) return source;

  return {
    ...source,
    materializedViews: source.materializedViews.map(view => {
      return {
        ...view,
        minGranularity: mapGranularityToExternalFormat(view.minGranularity),
      };
    }),
  };
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
 *           description: The granularity of the timestamp column
 *           enum: [1s, 15s, 30s, 1m, 5m, 15m, 30m, 1h, 2h, 6h, 12h, 1d, 2d, 7d, 30d]
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
 *         - id
 *         - name
 *         - kind
 *         - connection
 *         - from
 *         - defaultTableSelectExpression
 *         - timestampValueExpression
 *       properties:
 *         id:
 *           type: string
 *           description: Unique source ID.
 *           example: 507f1f77bcf86cd799439011
 *         name:
 *           type: string
 *           description: Display name for the source.
 *           example: Logs
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
 *     TraceSource:
 *       type: object
 *       required:
 *         - id
 *         - name
 *         - kind
 *         - connection
 *         - from
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
 *           description: Unique source ID.
 *           example: 507f1f77bcf86cd799439021
 *         name:
 *           type: string
 *           description: Display name for the source.
 *           example: Traces
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
 *           nullable: true
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
 *     MetricSource:
 *       type: object
 *       required:
 *         - id
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
 *           description: Unique source ID.
 *           example: 507f1f77bcf86cd799439041
 *         name:
 *           type: string
 *           description: Display name for the source.
 *           example: Metrics
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
 *         - id
 *         - name
 *         - kind
 *         - connection
 *         - from
 *         - traceSourceId
 *       properties:
 *         id:
 *           type: string
 *           description: Unique source ID.
 *           example: 507f1f77bcf86cd799439031
 *         name:
 *           type: string
 *           description: Display name for the source.
 *           example: Sessions
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
 *     Source:
 *       oneOf:
 *         - $ref: '#/components/schemas/LogSource'
 *         - $ref: '#/components/schemas/TraceSource'
 *         - $ref: '#/components/schemas/MetricSource'
 *         - $ref: '#/components/schemas/SessionSource'
 *       discriminator:
 *         propertyName: kind
 *         mapping:
 *           log: '#/components/schemas/LogSource'
 *           trace: '#/components/schemas/TraceSource'
 *           metric: '#/components/schemas/MetricSource'
 *           session: '#/components/schemas/SessionSource'
 *     SourcesListResponse:
 *       type: object
 *       properties:
 *         data:
 *           type: array
 *           description: List of source objects.
 *           items:
 *             $ref: '#/components/schemas/Source'
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
      return res.sendStatus(403);
    }

    const sources: SourceDocument[] = await getSources(teamId.toString());

    return res.json({
      data: sources.map(formatExternalSource).filter(s => s !== undefined),
    });
  } catch (e) {
    next(e);
  }
});

export default router;
