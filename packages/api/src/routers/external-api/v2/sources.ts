import {
  SourceSchema,
  type TSourceUnion,
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

function mapSourceToExternalSource(source: TSourceUnion): TSourceUnion {
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

function formatExternalSource(source: SourceDocument) {
  // Convert to JSON so that any ObjectIds are converted to strings
  const json = JSON.stringify(source.toJSON({ getters: true }));

  // Parse using the SourceSchema to strip out any fields not defined in the schema
  const parseResult = SourceSchema.safeParse(JSON.parse(json));
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
 *         value:
 *           type: string
 *           description: Setting value
 *     SourceFrom:
 *       type: object
 *       required:
 *         - databaseName
 *         - tableName
 *       properties:
 *         databaseName:
 *           type: string
 *           description: ClickHouse database name
 *         tableName:
 *           type: string
 *           description: ClickHouse table name
 *     MetricSourceFrom:
 *       type: object
 *       required:
 *         - databaseName
 *       properties:
 *         databaseName:
 *           type: string
 *           description: ClickHouse database name
 *         tableName:
 *           type: string
 *           description: ClickHouse table name
 *           nullable: true
 *     MetricTables:
 *       type: object
 *       description: Mapping of metric data types to table names. At least one must be specified.
 *       properties:
 *         gauge:
 *           type: string
 *           description: Table containing gauge metrics data
 *         histogram:
 *           type: string
 *           description: Table containing histogram metrics data
 *         sum:
 *           type: string
 *           description: Table containing sum metrics data
 *         summary:
 *           type: string
 *           description: Table containing summary metrics data. Note - not yet fully supported by HyperDX
 *         exponential histogram:
 *           type: string
 *           description: Table containing exponential histogram metrics data. Note - not yet fully supported by HyperDX
 *     HighlightedAttributeExpression:
 *       type: object
 *       required:
 *         - sqlExpression
 *       properties:
 *         sqlExpression:
 *           type: string
 *           description: SQL expression for the attribute
 *         luceneExpression:
 *           type: string
 *           description: An optional, Lucene version of the sqlExpression expression. If provided, it is used when searching for this attribute value.
 *           nullable: true
 *         alias:
 *           type: string
 *           description: Optional alias for the attribute
 *           nullable: true
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
 *         aggFn:
 *           type: string
 *           description: Aggregation function (e.g., count, sum, avg)
 *         mvColumn:
 *           type: string
 *           description: Materialized view column name
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
 *         tableName:
 *           type: string
 *           description: Table name for the materialized view
 *         dimensionColumns:
 *           type: string
 *           description: Columns which are not pre-aggregated in the materialized view and can be used for filtering and grouping.
 *         minGranularity:
 *           type: string
 *           description: The granularity of the timestamp column
 *           enum: [1s, 15s, 30s, 1m, 5m, 15m, 30m, 1h, 2h, 6h, 12h, 1d, 2d, 7d, 30d]
 *         minDate:
 *           type: string
 *           format: date-time
 *           description: (Optional) The earliest date and time for which the materialized view contains data. If not provided, then HyperDX will assume that the materialized view contains data for all dates for which the source table contains data.
 *           nullable: true
 *         timestampColumn:
 *           type: string
 *           description: Timestamp column name
 *         aggregatedColumns:
 *           type: array
 *           description: Columns which are pre-aggregated by the materialized view
 *           items:
 *             $ref: '#/components/schemas/AggregatedColumn'
 *     SourceKind:
 *       type: string
 *       enum: [log, trace, session, metric]
 *       description: The type of data source.
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
 *         name:
 *           type: string
 *         kind:
 *           type: string
 *           enum: [log]
 *         connection:
 *           type: string
 *         from:
 *           $ref: '#/components/schemas/SourceFrom'
 *         querySettings:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/QuerySetting'
 *           nullable: true
 *         defaultTableSelectExpression:
 *           type: string
 *           description: Default columns selected in search results (this can be customized per search later)
 *         timestampValueExpression:
 *           type: string
 *           description: DateTime column or expression that is part of your table's primary key.
 *         serviceNameExpression:
 *           type: string
 *           nullable: true
 *         severityTextExpression:
 *           type: string
 *           nullable: true
 *         bodyExpression:
 *           type: string
 *           nullable: true
 *         eventAttributesExpression:
 *           type: string
 *           nullable: true
 *         resourceAttributesExpression:
 *           type: string
 *           nullable: true
 *         displayedTimestampValueExpression:
 *           type: string
 *           description: This DateTime column is used to display and order search results.
 *           nullable: true
 *         metricSourceId:
 *           type: string
 *           description: HyperDX Source for metrics associated with logs. Optional
 *           nullable: true
 *         traceSourceId:
 *           type: string
 *           description: HyperDX Source for traces associated with logs. Optional
 *           nullable: true
 *         traceIdExpression:
 *           type: string
 *           nullable: true
 *         spanIdExpression:
 *           type: string
 *           nullable: true
 *         implicitColumnExpression:
 *           type: string
 *           description: Column used for full text search if no property is specified in a Lucene-based search. Typically the message body of a log.
 *           nullable: true
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
 *         name:
 *           type: string
 *         kind:
 *           type: string
 *           enum: [trace]
 *         connection:
 *           type: string
 *         from:
 *           $ref: '#/components/schemas/SourceFrom'
 *         querySettings:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/QuerySetting'
 *           nullable: true
 *         defaultTableSelectExpression:
 *           type: string
 *           description: Default columns selected in search results (this can be customized per search later)
 *           nullable: true
 *         timestampValueExpression:
 *           type: string
 *           description: DateTime column or expression defines the start of the span
 *         durationExpression:
 *           type: string
 *         durationPrecision:
 *           type: integer
 *           minimum: 0
 *           maximum: 9
 *           default: 3
 *         traceIdExpression:
 *           type: string
 *         spanIdExpression:
 *           type: string
 *         parentSpanIdExpression:
 *           type: string
 *         spanNameExpression:
 *           type: string
 *         spanKindExpression:
 *           type: string
 *         logSourceId:
 *           type: string
 *           description: HyperDX Source for logs associated with traces. Optional
 *           nullable: true
 *         sessionSourceId:
 *           type: string
 *           description: HyperDX Source for sessions associated with traces. Optional
 *           nullable: true
 *         metricSourceId:
 *           type: string
 *           description: HyperDX Source for metrics associated with traces. Optional
 *           nullable: true
 *         statusCodeExpression:
 *           type: string
 *           nullable: true
 *         statusMessageExpression:
 *           type: string
 *           nullable: true
 *         serviceNameExpression:
 *           type: string
 *           nullable: true
 *         resourceAttributesExpression:
 *           type: string
 *           nullable: true
 *         eventAttributesExpression:
 *           type: string
 *           nullable: true
 *         spanEventsValueExpression:
 *           type: string
 *           description: Expression to extract span events. Used to capture events associated with spans. Expected to be Nested ( Timestamp DateTime64(9), Name LowCardinality(String), Attributes Map(LowCardinality(String), String)
 *           nullable: true
 *         implicitColumnExpression:
 *           type: string
 *           description: Column used for full text search if no property is specified in a Lucene-based search. Typically the message body of a log.
 *           nullable: true
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
 *         name:
 *           type: string
 *         kind:
 *           type: string
 *           enum: [metric]
 *         connection:
 *           type: string
 *         from:
 *           $ref: '#/components/schemas/MetricSourceFrom'
 *         querySettings:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/QuerySetting'
 *           nullable: true
 *         metricTables:
 *           $ref: '#/components/schemas/MetricTables'
 *         timestampValueExpression:
 *           type: string
 *           description: DateTime column or expression that is part of your table's primary key.
 *         resourceAttributesExpression:
 *           type: string
 *           description: Column containing resource attributes for metrics
 *         logSourceId:
 *           type: string
 *           description: HyperDX Source for logs associated with metrics. Optional
 *           nullable: true
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
 *         name:
 *           type: string
 *         kind:
 *           type: string
 *           enum: [session]
 *         connection:
 *           type: string
 *         from:
 *           $ref: '#/components/schemas/SourceFrom'
 *         querySettings:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/QuerySetting'
 *           nullable: true
 *         timestampValueExpression:
 *           type: string
 *           description: DateTime column or expression that is part of your table's primary key.
 *           nullable: true
 *         traceSourceId:
 *           type: string
 *           description: HyperDX Source for traces associated with sessions.
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
