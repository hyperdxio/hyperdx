import express from 'express';
import { uniq } from 'lodash';
import { z } from 'zod';

import { deleteDashboard } from '@/controllers/dashboard';
import Dashboard, { IDashboard } from '@/models/dashboard';
import { processRequestWithEnhancedErrors as validateRequest } from '@/utils/enhancedErrors';
import { ExternalDashboardTileWithId, objectIdSchema } from '@/utils/zod';

import {
  cleanupDashboardAlerts,
  convertExternalFiltersToInternal,
  convertExternalTilesToInternal,
  convertToExternalDashboard,
  createDashboardBodySchema,
  resolveSavedQueryLanguage,
  updateDashboardBodySchema,
  validateDashboardTiles,
} from './utils/dashboards';

/**
 * Projection used by the GET-list and GET-by-id Dashboard endpoints, kept in
 * one place so adding a new field doesn't need touching both call sites.
 * Mirrors the shape consumed by `convertToExternalDashboard`.
 */
const EXTERNAL_DASHBOARD_PROJECTION = {
  _id: 1,
  name: 1,
  tiles: 1,
  tags: 1,
  filters: 1,
  savedQuery: 1,
  savedQueryLanguage: 1,
  savedFilterValues: 1,
  containers: 1,
} as const;

/**
 * @openapi
 * components:
 *   schemas:
 *     NumberFormatOutput:
 *       type: string
 *       enum: [currency, percent, byte, time, number, data_rate, throughput, duration]
 *       description: Output format type (currency, percent, byte, time, number, data_rate, throughput, duration).
 *     AggregationFunction:
 *       type: string
 *       enum: [avg, count, count_distinct, last_value, max, min, quantile, sum, any, none]
 *       description: Aggregation function to apply to the field or metric value.
 *     QueryLanguage:
 *       type: string
 *       enum: [sql, lucene]
 *       description: Query language for the where clause.
 *     SavedFilterValue:
 *       type: object
 *       required: [condition]
 *       properties:
 *         type:
 *           type: string
 *           enum: [sql]
 *           default: sql
 *           description: Filter type. Currently only "sql" is supported.
 *           example: "sql"
 *         condition:
 *           type: string
 *           description: SQL filter condition. For example use expressions in the form "column IN ('value')".
 *           example: "ServiceName IN ('hdx-oss-dev-api')"
 *     MetricDataType:
 *       type: string
 *       enum: [sum, gauge, histogram, summary, exponential histogram]
 *       description: Metric data type, only for metrics data sources.
 *     TimeSeriesDisplayType:
 *       type: string
 *       enum: [stacked_bar, line]
 *       description: Visual representation type for the time series.
 *     QuantileLevel:
 *       type: number
 *       enum: [0.5, 0.90, 0.95, 0.99]
 *       description: Percentile level; only valid when aggFn is "quantile".
 *     SortOrder:
 *       type: string
 *       enum: [desc, asc]
 *       description: Sort order for table rows.
 *     NumberFormat:
 *       type: object
 *       properties:
 *         output:
 *           $ref: '#/components/schemas/NumberFormatOutput'
 *           description: Output format applied to the number.
 *           example: "number"
 *         mantissa:
 *           type: integer
 *           description: Number of decimal places.
 *           example: 2
 *         thousandSeparated:
 *           type: boolean
 *           description: Whether to use thousand separators.
 *           example: true
 *         average:
 *           type: boolean
 *           description: Whether to show as average.
 *           example: false
 *         decimalBytes:
 *           type: boolean
 *           description: Use decimal bytes (1000) vs binary bytes (1024).
 *           example: false
 *         factor:
 *           type: number
 *           description: Multiplication factor.
 *           example: 1
 *         currencySymbol:
 *           type: string
 *           description: Currency symbol for currency format.
 *           example: "$"
 *         numericUnit:
 *           type: string
 *           enum: [bytes_iec, bytes_si, bits_iec, bits_si, kibibytes, kilobytes, mebibytes, megabytes, gibibytes, gigabytes, tebibytes, terabytes, pebibytes, petabytes, packets_sec, bytes_sec_iec, bytes_sec_si, bits_sec_iec, bits_sec_si, kibibytes_sec, kibibits_sec, kilobytes_sec, kilobits_sec, mebibytes_sec, mebibits_sec, megabytes_sec, megabits_sec, gibibytes_sec, gibibits_sec, gigabytes_sec, gigabits_sec, tebibytes_sec, tebibits_sec, terabytes_sec, terabits_sec, pebibytes_sec, pebibits_sec, petabytes_sec, petabits_sec, cps, ops, rps, reads_sec, wps, iops, cpm, opm, rpm_reads, wpm]
 *           description: Numeric unit for data, data rate, or throughput formats.
 *           example: "bytes_iec"
 *         unit:
 *           type: string
 *           description: Custom unit label.
 *           example: "ms"
 *
 *     ChartPaletteToken:
 *       type: string
 *       enum: [chart-blue, chart-orange, chart-red, chart-cyan, chart-green, chart-pink, chart-purple, chart-light-blue, chart-brown, chart-gray, chart-success, chart-warning, chart-error]
 *       description: >
 *         Palette token used to color a number tile. Tokens reflow across
 *         light and dark themes, so raw hex values are not accepted.
 *       example: "chart-red"
 *     BackgroundChart:
 *       type: object
 *       required:
 *         - type
 *       description: >
 *         Optional background trend sparkline drawn behind a number tile's
 *         value, derived from a time-bucketed version of the tile's query.
 *         Builder number tiles only (raw SQL number tiles have no time
 *         dimension to bucket).
 *       properties:
 *         type:
 *           type: string
 *           enum: [line, area]
 *           description: Sparkline shape.
 *           example: "line"
 *         color:
 *           $ref: '#/components/schemas/ChartPaletteToken'
 *           description: >
 *             Optional palette-token override for the sparkline. When unset
 *             the sparkline inherits the tile's static color.
 *     NumericColorCondition:
 *       type: object
 *       required:
 *         - operator
 *         - value
 *         - color
 *       description: Color rule comparing the displayed value against a single numeric bound.
 *       properties:
 *         operator:
 *           type: string
 *           enum: [gt, gte, lt, lte]
 *           description: Numeric comparison operator.
 *           example: "gt"
 *         value:
 *           type: number
 *           description: >
 *             Numeric bound the displayed value is compared against. Only
 *             finite numbers are accepted (Infinity and NaN are rejected).
 *           example: 100
 *         color:
 *           $ref: '#/components/schemas/ChartPaletteToken'
 *           description: Color applied when the rule matches.
 *         label:
 *           type: string
 *           maxLength: 40
 *           description: Optional label describing the rule.
 *           example: "High"
 *     BetweenColorCondition:
 *       type: object
 *       required:
 *         - operator
 *         - value
 *         - color
 *       description: Color rule matching when the displayed value falls within an inclusive range.
 *       properties:
 *         operator:
 *           type: string
 *           enum: [between]
 *           description: Range comparison operator.
 *           example: "between"
 *         value:
 *           type: array
 *           minItems: 2
 *           maxItems: 2
 *           items:
 *             type: number
 *           description: >
 *             Inclusive [min, max] range. Both bounds must be finite numbers.
 *           example: [100, 500]
 *         color:
 *           $ref: '#/components/schemas/ChartPaletteToken'
 *           description: Color applied when the rule matches.
 *         label:
 *           type: string
 *           maxLength: 40
 *           description: Optional label describing the rule.
 *           example: "Warning"
 *     EqualityColorCondition:
 *       type: object
 *       required:
 *         - operator
 *         - value
 *         - color
 *       description: Color rule matching when the displayed value equals (eq) or does not equal (neq) a number or string.
 *       properties:
 *         operator:
 *           type: string
 *           enum: [eq, neq]
 *           description: Equality comparison operator.
 *           example: "eq"
 *         value:
 *           oneOf:
 *             - type: number
 *             - type: string
 *               maxLength: 200
 *           description: >
 *             A finite number, or a string up to 200 characters, to compare
 *             for equality.
 *           example: "OK"
 *         color:
 *           $ref: '#/components/schemas/ChartPaletteToken'
 *           description: Color applied when the rule matches.
 *         label:
 *           type: string
 *           maxLength: 40
 *           description: Optional label describing the rule.
 *           example: "Healthy"
 *     NumberTileColorCondition:
 *       description: >
 *         A single conditional color rule for a number tile. Rules are
 *         evaluated in order and the last matching rule wins. When no rule
 *         matches, the static color applies, then the default text color.
 *         The number-tile editor surfaces numeric and equality operators
 *         only.
 *       oneOf:
 *         - $ref: '#/components/schemas/NumericColorCondition'
 *         - $ref: '#/components/schemas/BetweenColorCondition'
 *         - $ref: '#/components/schemas/EqualityColorCondition'
 *       discriminator:
 *         propertyName: operator
 *         mapping:
 *           gt: '#/components/schemas/NumericColorCondition'
 *           gte: '#/components/schemas/NumericColorCondition'
 *           lt: '#/components/schemas/NumericColorCondition'
 *           lte: '#/components/schemas/NumericColorCondition'
 *           between: '#/components/schemas/BetweenColorCondition'
 *           eq: '#/components/schemas/EqualityColorCondition'
 *           neq: '#/components/schemas/EqualityColorCondition'
 *
 *     TimeChartSeries:
 *       type: object
 *       required:
 *         - type
 *         - sourceId
 *         - aggFn
 *         - where
 *         - whereLanguage
 *         - groupBy
 *       properties:
 *         type:
 *           type: string
 *           enum: [time]
 *           description: Series type discriminator. Must be "time" for time-series charts.
 *           example: "time"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query
 *           example: "65f5e4a3b9e77c001a567890"
 *         aggFn:
 *           $ref: '#/components/schemas/AggregationFunction'
 *           description: Aggregation function to apply to the field or metric value
 *           example: "count"
 *         level:
 *           type: number
 *           minimum: 0
 *           maximum: 1
 *           description: Percentile level for quantile aggregations (e.g., 0.95 for p95)
 *           example: 0.95
 *         field:
 *           type: string
 *           description: Column or expression to aggregate (required for most aggregation functions except count)
 *           example: "duration"
 *         alias:
 *           type: string
 *           description: Display name for the series in the chart
 *           example: "Request Duration"
 *         where:
 *           type: string
 *           description: Filter query for the data (syntax depends on whereLanguage)
 *           example: "service:api"
 *         whereLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           description: Query language for the where clause
 *           example: "lucene"
 *         groupBy:
 *           type: array
 *           items:
 *             type: string
 *           maxItems: 10
 *           description: Fields to group results by (creates separate series for each group)
 *           example: ["host"]
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *           description: Number formatting options for displayed values.
 *         metricDataType:
 *           $ref: '#/components/schemas/MetricDataType'
 *           description: Metric data type, only for metrics data sources.
 *           example: "sum"
 *         metricName:
 *           type: string
 *           description: Metric name for metrics data sources
 *           example: "http.server.duration"
 *         displayType:
 *           $ref: '#/components/schemas/TimeSeriesDisplayType'
 *           description: Visual representation type for the time series
 *           example: "line"
 *
 *     TableChartSeries:
 *       type: object
 *       required:
 *         - type
 *         - sourceId
 *         - aggFn
 *         - where
 *         - whereLanguage
 *         - groupBy
 *       properties:
 *         type:
 *           type: string
 *           enum: [table]
 *           description: Series type discriminator. Must be "table" for table charts.
 *           example: "table"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query
 *           example: "65f5e4a3b9e77c001a567890"
 *         aggFn:
 *           $ref: '#/components/schemas/AggregationFunction'
 *           description: Aggregation function to apply to the field or metric value
 *           example: "count"
 *         level:
 *           type: number
 *           minimum: 0
 *           maximum: 1
 *           description: Percentile level for quantile aggregations (e.g., 0.95 for p95)
 *           example: 0.95
 *         field:
 *           type: string
 *           description: Column or expression to aggregate (required for most aggregation functions except count)
 *           example: "duration"
 *         alias:
 *           type: string
 *           description: Display name for the series
 *           example: "Total Count"
 *         where:
 *           type: string
 *           description: Filter query for the data (syntax depends on whereLanguage)
 *           example: "level:error"
 *         whereLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           description: Query language for the where clause
 *           example: "lucene"
 *         groupBy:
 *           type: array
 *           items:
 *             type: string
 *           maxItems: 10
 *           description: Fields to group results by (creates separate rows for each group)
 *           example: ["errorType"]
 *         sortOrder:
 *           $ref: '#/components/schemas/SortOrder'
 *           description: Sort order for table rows
 *           example: "desc"
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *           description: Number formatting options for displayed values.
 *         metricDataType:
 *           $ref: '#/components/schemas/MetricDataType'
 *           description: Metric data type, only for metrics data sources.
 *           example: "sum"
 *         metricName:
 *           type: string
 *           description: Metric name for metrics data sources
 *           example: "http.server.duration"
 *
 *     NumberChartSeries:
 *       type: object
 *       required:
 *         - type
 *         - sourceId
 *         - aggFn
 *         - where
 *         - whereLanguage
 *       properties:
 *         type:
 *           type: string
 *           enum: [number]
 *           description: Series type discriminator. Must be "number" for single-value number charts.
 *           example: "number"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query
 *           example: "65f5e4a3b9e77c001a567890"
 *         aggFn:
 *           $ref: '#/components/schemas/AggregationFunction'
 *           description: Aggregation function to apply to the field or metric value
 *           example: "count"
 *         level:
 *           type: number
 *           minimum: 0
 *           maximum: 1
 *           description: Percentile level for quantile aggregations (e.g., 0.95 for p95)
 *           example: 0.95
 *         field:
 *           type: string
 *           description: Column or expression to aggregate (required for most aggregation functions except count)
 *           example: "duration"
 *         alias:
 *           type: string
 *           description: Display name for the series in the chart
 *           example: "Total Requests"
 *         where:
 *           type: string
 *           description: Filter query for the data (syntax depends on whereLanguage)
 *           example: "service:api"
 *         whereLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           description: Query language for the where clause
 *           example: "lucene"
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *           description: Number formatting options for displayed values.
 *         metricDataType:
 *           $ref: '#/components/schemas/MetricDataType'
 *           description: Metric data type, only for metrics data sources.
 *           example: "sum"
 *         metricName:
 *           type: string
 *           description: Metric name for metrics data sources.
 *           example: "http.server.duration"
 *
 *     SearchChartSeries:
 *       type: object
 *       required:
 *         - type
 *         - sourceId
 *         - fields
 *         - where
 *         - whereLanguage
 *       properties:
 *         type:
 *           type: string
 *           enum: [search]
 *           description: Series type discriminator. Must be "search" for search/log viewer charts.
 *           example: "search"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query
 *           example: "65f5e4a3b9e77c001a567890"
 *         fields:
 *           type: array
 *           items:
 *             type: string
 *           description: List of field names to display in the search results table
 *           example: ["timestamp", "level", "message"]
 *         where:
 *           type: string
 *           description: Filter query for the data (syntax depends on whereLanguage)
 *           example: "level:error"
 *         whereLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           description: Query language for the where clause
 *           example: "lucene"
 *
 *     MarkdownChartSeries:
 *       type: object
 *       required:
 *         - type
 *         - content
 *       properties:
 *         type:
 *           type: string
 *           enum: [markdown]
 *           description: Series type discriminator. Must be "markdown" for markdown text widgets.
 *           example: "markdown"
 *         content:
 *           type: string
 *           description: Markdown content to render inside the widget.
 *           example: "# Dashboard Title\n\nThis is a markdown widget."
 *           maxLength: 100000
 *
 *     DashboardChartSeries:
 *       oneOf:
 *         - $ref: '#/components/schemas/TimeChartSeries'
 *         - $ref: '#/components/schemas/TableChartSeries'
 *         - $ref: '#/components/schemas/NumberChartSeries'
 *         - $ref: '#/components/schemas/SearchChartSeries'
 *         - $ref: '#/components/schemas/MarkdownChartSeries'
 *       discriminator:
 *         propertyName: type
 *         mapping:
 *           time: '#/components/schemas/TimeChartSeries'
 *           table: '#/components/schemas/TableChartSeries'
 *           number: '#/components/schemas/NumberChartSeries'
 *           search: '#/components/schemas/SearchChartSeries'
 *           markdown: '#/components/schemas/MarkdownChartSeries'
 *
 *     SelectItem:
 *       type: object
 *       required:
 *         - aggFn
 *       description: >
 *         A single aggregated value to compute. The valueExpression must be
 *         omitted when aggFn is "count", and required for all other functions.
 *         The level field may only be used with aggFn "quantile".
 *       properties:
 *         aggFn:
 *           $ref: '#/components/schemas/AggregationFunction'
 *           description: >
 *             Aggregation function to apply. "count" does not require a valueExpression; "quantile" requires a level field indicating the desired percentile (e.g., 0.95).
 *           example: "count"
 *         valueExpression:
 *           type: string
 *           maxLength: 10000
 *           description: >
 *             Expression for the column or value to aggregate. Must be omitted when
 *             aggFn is "count"; required for all other aggFn values.
 *           example: "Duration"
 *         alias:
 *           type: string
 *           maxLength: 10000
 *           description: Display alias for this select item in chart legends.
 *           example: "Request Duration"
 *         level:
 *           $ref: '#/components/schemas/QuantileLevel'
 *           description: Percentile level; only valid when aggFn is "quantile".
 *         where:
 *           type: string
 *           maxLength: 10000
 *           description: SQL or Lucene filter condition applied before aggregation.
 *           default: ""
 *           example: "service:api"
 *         whereLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           description: Query language for the where clause.
 *         metricName:
 *           type: string
 *           description: Name of the metric to aggregate; only applicable when the source is a metrics source.
 *           example: "http.server.duration"
 *         metricType:
 *           $ref: '#/components/schemas/MetricDataType'
 *           description: Metric type; only applicable when the source is a metrics source.
 *         periodAggFn:
 *           type: string
 *           enum: [delta]
 *           description: Optional period aggregation function for Gauge metrics (e.g., compute the delta over the period).
 *           example: "delta"
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *           description: >
 *             Per-series number formatting options. When set, takes precedence
 *             over the chart-level numberFormat for this select item only.
 *
 *     LineBuilderChartConfig:
 *       type: object
 *       required:
 *         - displayType
 *         - sourceId
 *         - select
 *       description: Builder configuration for a line time-series chart.
 *       properties:
 *         displayType:
 *           type: string
 *           enum: [line]
 *           description: Display type discriminator. Must be "line" for line charts.
 *           example: "line"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query.
 *           example: "65f5e4a3b9e77c001a111111"
 *         select:
 *           type: array
 *           minItems: 1
 *           maxItems: 20
 *           description: >
 *             One or more aggregated values to plot. When asRatio is true,
 *             exactly two select items are required.
 *           items:
 *             $ref: '#/components/schemas/SelectItem'
 *         groupBy:
 *           type: string
 *           description: Field expression to group results by (creates separate lines per group value).
 *           example: "host"
 *           maxLength: 10000
 *         asRatio:
 *           type: boolean
 *           description: Plot select[0] / select[1] as a ratio. Requires exactly two select items.
 *           default: false
 *         alignDateRangeToGranularity:
 *           type: boolean
 *           description: Expand date range boundaries to the query granularity interval.
 *           default: true
 *         fillNulls:
 *           type: boolean
 *           description: Fill missing time buckets with zero instead of leaving gaps.
 *           default: true
 *         fitYAxisToData:
 *           type: boolean
 *           description: >
 *             Set the y-axis lower bound to the minimum of the displayed data
 *             instead of zero, making small fluctuations between series easier
 *             to see.
 *           default: false
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *           description: Number formatting options for displayed values.
 *         compareToPreviousPeriod:
 *           type: boolean
 *           description: Overlay the equivalent previous time period for comparison.
 *           default: false
 *
 *     BarBuilderChartConfig:
 *       type: object
 *       required:
 *         - displayType
 *         - sourceId
 *         - select
 *       description: Builder configuration for a stacked-bar time-series chart.
 *       properties:
 *         displayType:
 *           type: string
 *           enum: [stacked_bar]
 *           description: Display type discriminator. Must be "stacked_bar" for stacked-bar charts.
 *           example: "stacked_bar"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query.
 *           example: "65f5e4a3b9e77c001a111111"
 *         select:
 *           type: array
 *           minItems: 1
 *           maxItems: 20
 *           description: >
 *             One or more aggregated values to plot. When asRatio is true,
 *             exactly two select items are required.
 *           items:
 *             $ref: '#/components/schemas/SelectItem'
 *         groupBy:
 *           type: string
 *           description: Field expression to group results by (creates separate bars segments per group value).
 *           example: "service"
 *           maxLength: 10000
 *         asRatio:
 *           type: boolean
 *           description: Plot select[0] / select[1] as a ratio. Requires exactly two select items.
 *           default: false
 *         alignDateRangeToGranularity:
 *           type: boolean
 *           description: Align the date range boundaries to the query granularity interval.
 *           default: true
 *         fillNulls:
 *           type: boolean
 *           description: Fill missing time buckets with zero instead of leaving gaps.
 *           default: true
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *           description: Number formatting options for displayed values.
 *
 *     TableBuilderChartConfig:
 *       type: object
 *       required:
 *         - displayType
 *         - sourceId
 *         - select
 *       description: Builder configuration for a table aggregation chart.
 *       properties:
 *         displayType:
 *           type: string
 *           enum: [table]
 *           description: Display type discriminator. Must be "table" for table charts.
 *           example: "table"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query.
 *           example: "65f5e4a3b9e77c001a111111"
 *         select:
 *           type: array
 *           minItems: 1
 *           maxItems: 20
 *           description: >
 *             One or more aggregated values to display as table columns.
 *             When asRatio is true, exactly two select items are required.
 *           items:
 *             $ref: '#/components/schemas/SelectItem'
 *         groupBy:
 *           type: string
 *           maxLength: 10000
 *           description: Field expression to group results by (one row per group value).
 *           example: "service"
 *         having:
 *           type: string
 *           maxLength: 10000
 *           description: Post-aggregation SQL HAVING condition.
 *           example: "count > 100"
 *         orderBy:
 *           type: string
 *           maxLength: 10000
 *           description: SQL ORDER BY expression for sorting table rows.
 *           example: "count DESC"
 *         asRatio:
 *           type: boolean
 *           description: Display select[0] / select[1] as a ratio. Requires exactly two select items.
 *           example: false
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *           description: Number formatting options for displayed values.
 *         groupByColumnsOnLeft:
 *           type: boolean
 *           description: >
 *             When true, render Group By columns to the left of series columns
 *             in the table. Defaults to false (Group By columns on the right).
 *           default: false
 *           example: false
 *         onClick:
 *           $ref: '#/components/schemas/OnClick'
 *           description: Optional link-out configuration applied when a user clicks a row.
 *
 *     NumberBuilderChartConfig:
 *       type: object
 *       required:
 *         - displayType
 *         - sourceId
 *         - select
 *       description: Builder configuration for a single big-number chart.
 *       properties:
 *         displayType:
 *           type: string
 *           enum: [number]
 *           description: Display type discriminator. Must be "number" for single big-number charts.
 *           example: "number"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query.
 *           example: "65f5e4a3b9e77c001a111111"
 *         select:
 *           type: array
 *           minItems: 1
 *           maxItems: 1
 *           description: Exactly one aggregated value to display as a single number.
 *           items:
 *             $ref: '#/components/schemas/SelectItem'
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *           description: Number formatting options for displayed values.
 *         color:
 *           $ref: '#/components/schemas/ChartPaletteToken'
 *           description: Optional static color applied to the displayed number.
 *         colorRules:
 *           type: array
 *           maxItems: 10
 *           description: >
 *             Ordered conditional color rules evaluated against the displayed
 *             value (last match wins). Falls back to color, then the default
 *             text color when no rule matches.
 *           items:
 *             $ref: '#/components/schemas/NumberTileColorCondition'
 *         backgroundChart:
 *           $ref: '#/components/schemas/BackgroundChart'
 *           description: >
 *             Optional background trend sparkline drawn behind the value.
 *
 *     PieBuilderChartConfig:
 *       type: object
 *       required:
 *         - displayType
 *         - sourceId
 *         - select
 *       description: Builder configuration for a pie chart tile. Each slice represents one group value.
 *       properties:
 *         displayType:
 *           type: string
 *           enum: [pie]
 *           description: Display type discriminator. Must be "pie" for pie charts.
 *           example: "pie"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query.
 *           example: "65f5e4a3b9e77c001a111111"
 *         select:
 *           type: array
 *           minItems: 1
 *           maxItems: 1
 *           description: Exactly one aggregated value used to size each pie slice.
 *           items:
 *             $ref: '#/components/schemas/SelectItem'
 *         groupBy:
 *           type: string
 *           maxLength: 10000
 *           description: Field expression to group results by (one slice per group value).
 *           example: "service"
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *           description: Number formatting options for displayed values.
 *
 *     HeatmapSelectItem:
 *       type: object
 *       required:
 *         - valueExpression
 *       description: >
 *         Single select item for a heatmap tile. The value being bucketed is
 *         provided in valueExpression and the count contributing to each
 *         bucket in countExpression. The heatmap-specific fields
 *         (countExpression, heatmapScaleType) are persisted on the select
 *         item, not the chart config. The chart-level discriminator is the
 *         HeatmapChartConfig's `displayType: "heatmap"`; no aggregation
 *         function or alias is exposed on this select item because the
 *         heatmap aggregation function is fixed internally and the
 *         HeatmapSeriesEditor does not render an alias input.
 *       properties:
 *         valueExpression:
 *           type: string
 *           minLength: 1
 *           maxLength: 10000
 *           description: SQL expression for the value being bucketed on the y-axis. Must be non-empty.
 *           example: "Duration"
 *         countExpression:
 *           type: string
 *           maxLength: 10000
 *           description: >
 *             SQL expression for the count contributing to each bucket. Defaults
 *             to "count()" in the editor when omitted.
 *           example: "count()"
 *         heatmapScaleType:
 *           type: string
 *           enum: [log, linear]
 *           description: Scale type used to bucket values on the y-axis.
 *           example: "log"
 *
 *     HeatmapChartConfig:
 *       type: object
 *       required:
 *         - displayType
 *         - sourceId
 *         - select
 *       description: >
 *         Builder configuration for a heatmap tile. Heatmap is builder-only
 *         (no Raw SQL variant) and currently supports trace sources. The
 *         row-level filter lives at the chart-config level (where /
 *         whereLanguage), matching the HeatmapSeriesEditor in the UI.
 *       properties:
 *         displayType:
 *           type: string
 *           enum: [heatmap]
 *           description: Display type discriminator. Must be "heatmap" for heatmap tiles.
 *           example: "heatmap"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query.
 *           example: "65f5e4a3b9e77c001a111111"
 *         select:
 *           type: array
 *           minItems: 1
 *           maxItems: 1
 *           description: Exactly one heatmap select item.
 *           items:
 *             $ref: '#/components/schemas/HeatmapSelectItem'
 *         where:
 *           type: string
 *           maxLength: 10000
 *           description: Row-level filter (syntax depends on whereLanguage).
 *           default: ""
 *           example: "ServiceName = 'api'"
 *         whereLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           description: Query language for the where clause.
 *           default: "lucene"
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *           description: Number formatting options for displayed values.
 *
 *     SearchChartConfig:
 *       type: object
 *       required:
 *         - displayType
 *         - sourceId
 *         - select
 *         - whereLanguage
 *       description: Configuration for a raw-event search / log viewer tile.
 *       properties:
 *         displayType:
 *           type: string
 *           enum: [search]
 *           description: Display type discriminator. Must be "search" for search/log viewer tiles.
 *           example: "search"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query.
 *           example: "65f5e4a3b9e77c001a111111"
 *         select:
 *           type: string
 *           maxLength: 10000
 *           description: Comma-separated list of expressions to display.
 *           example: "timestamp, level, message"
 *         where:
 *           type: string
 *           maxLength: 10000
 *           description: Filter condition for the search (syntax depends on whereLanguage).
 *           default: ""
 *           example: "level:error"
 *         whereLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           description: Query language for the where clause.
 *
 *     MarkdownChartConfig:
 *       type: object
 *       required:
 *         - displayType
 *       description: Configuration for a freeform Markdown text tile.
 *       properties:
 *         displayType:
 *           type: string
 *           enum: [markdown]
 *           description: Display type discriminator. Must be "markdown" for markdown text tiles.
 *           example: "markdown"
 *         markdown:
 *           type: string
 *           maxLength: 50000
 *           description: Markdown content to render inside the tile.
 *           example: "# Dashboard Title\n\nThis is a markdown widget."
 *
 *     RawSqlChartConfigBase:
 *       type: object
 *       required:
 *         - configType
 *         - connectionId
 *         - sqlTemplate
 *       description: Shared fields for Raw SQL chart configs. Set configType to "sql" and provide connectionId + sqlTemplate instead of sourceId + select.
 *       properties:
 *         configType:
 *           type: string
 *           enum: [sql]
 *           description: Must be "sql" to use the Raw SQL chart config variant.
 *           example: "sql"
 *         connectionId:
 *           type: string
 *           description: ID of the ClickHouse connection to execute the query against.
 *           example: "65f5e4a3b9e77c001a567890"
 *         sqlTemplate:
 *           type: string
 *           maxLength: 100000
 *           description: SQL query template to execute. Supports HyperDX template variables.
 *           example: "SELECT count() FROM otel_logs WHERE timestamp > now() - INTERVAL 1 HOUR"
 *         sourceId:
 *           type: string
 *           description: Optional ID of the data source associated with this Raw SQL chart. Used for applying dashboard filters.
 *           example: "65f5e4a3b9e77c001a567890"
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *           description: Number formatting options for displayed values.
 *
 *     LineRawSqlChartConfig:
 *       description: Raw SQL configuration for a line time-series chart.
 *       allOf:
 *         - $ref: '#/components/schemas/RawSqlChartConfigBase'
 *         - type: object
 *           required:
 *             - displayType
 *           properties:
 *             displayType:
 *               type: string
 *               enum: [line]
 *               description: Display as a line time-series chart.
 *               example: "line"
 *             compareToPreviousPeriod:
 *               type: boolean
 *               description: Overlay the equivalent previous time period for comparison.
 *               default: false
 *             fillNulls:
 *               type: boolean
 *               description: Fill missing time buckets with zero instead of leaving gaps.
 *               default: true
 *             alignDateRangeToGranularity:
 *               type: boolean
 *               description: Expand date range boundaries to the query granularity interval.
 *               default: true
 *             fitYAxisToData:
 *               type: boolean
 *               description: >
 *                 Set the y-axis lower bound to the minimum of the displayed
 *                 data instead of zero, making small fluctuations between
 *                 series easier to see.
 *               default: false
 *
 *     BarRawSqlChartConfig:
 *       description: Raw SQL configuration for a stacked-bar time-series chart.
 *       allOf:
 *         - $ref: '#/components/schemas/RawSqlChartConfigBase'
 *         - type: object
 *           required:
 *             - displayType
 *           properties:
 *             displayType:
 *               type: string
 *               enum: [stacked_bar]
 *               description: Display as a stacked-bar time-series chart.
 *               example: "stacked_bar"
 *             fillNulls:
 *               type: boolean
 *               description: Fill missing time buckets with zero instead of leaving gaps.
 *               default: true
 *             alignDateRangeToGranularity:
 *               type: boolean
 *               description: Expand date range boundaries to the query granularity interval.
 *               default: true
 *
 *     TableRawSqlChartConfig:
 *       description: Raw SQL configuration for a table chart.
 *       allOf:
 *         - $ref: '#/components/schemas/RawSqlChartConfigBase'
 *         - type: object
 *           required:
 *             - displayType
 *           properties:
 *             displayType:
 *               type: string
 *               enum: [table]
 *               description: Display as a table chart.
 *               example: "table"
 *             onClick:
 *               $ref: '#/components/schemas/OnClick'
 *               description: Optional link-out configuration applied when a user clicks a row.
 *
 *     NumberRawSqlChartConfig:
 *       description: Raw SQL configuration for a single big-number chart.
 *       allOf:
 *         - $ref: '#/components/schemas/RawSqlChartConfigBase'
 *         - type: object
 *           required:
 *             - displayType
 *           properties:
 *             displayType:
 *               type: string
 *               enum: [number]
 *               description: Display as a single big-number chart.
 *               example: "number"
 *             color:
 *               $ref: '#/components/schemas/ChartPaletteToken'
 *               description: >
 *                 Optional static color applied to the displayed number. Raw
 *                 SQL number tiles do not support conditional colorRules.
 *
 *     PieRawSqlChartConfig:
 *       description: Raw SQL configuration for a pie chart.
 *       allOf:
 *         - $ref: '#/components/schemas/RawSqlChartConfigBase'
 *         - type: object
 *           required:
 *             - displayType
 *           properties:
 *             displayType:
 *               type: string
 *               enum: [pie]
 *               description: Display as a pie chart.
 *               example: "pie"
 *
 *     LineChartConfig:
 *       description: >
 *         Line chart. Omit configType for the builder variant (requires sourceId
 *         and select). Set configType to "sql" for the Raw SQL variant (requires
 *         connectionId and sqlTemplate).
 *       oneOf:
 *         - $ref: '#/components/schemas/LineBuilderChartConfig'
 *         - $ref: '#/components/schemas/LineRawSqlChartConfig'
 *       discriminator:
 *         propertyName: configType
 *         mapping:
 *           sql: '#/components/schemas/LineRawSqlChartConfig'
 *
 *     BarChartConfig:
 *       description: >
 *         Stacked-bar chart. Omit configType for the builder variant (requires
 *         sourceId and select). Set configType to "sql" for the Raw SQL variant
 *         (requires connectionId and sqlTemplate).
 *       oneOf:
 *         - $ref: '#/components/schemas/BarBuilderChartConfig'
 *         - $ref: '#/components/schemas/BarRawSqlChartConfig'
 *       discriminator:
 *         propertyName: configType
 *         mapping:
 *           sql: '#/components/schemas/BarRawSqlChartConfig'
 *
 *     OnClickFilterTemplate:
 *       type: object
 *       description: >
 *         A templated filter applied to the link-out destination. The rendered
 *         template value is combined with the expression as `expression IN (...)`
 *         on the destination search or dashboard. Multiple templates sharing the
 *         same expression are merged into a single IN clause.
 *       required: [kind, expression, template]
 *       properties:
 *         kind:
 *           type: string
 *           enum: [expressionTemplate]
 *           description: Filter template kind. Currently only "expressionTemplate" is supported.
 *           example: "expressionTemplate"
 *         expression:
 *           type: string
 *           minLength: 1
 *           description: The column/expression to filter the destination by (e.g. "ServiceName").
 *           example: "ServiceName"
 *         template:
 *           type: string
 *           minLength: 1
 *           description: >
 *             Value template rendered against the clicked row; supports row column
 *             variables in `{{column}}` form (e.g. `{{ServiceName}}`).
 *           example: "{{ServiceName}}"
 *
 *     OnClickTarget:
 *       description: >
 *         Identifies the source (for type=search) or dashboard (for type=dashboard)
 *         to link out to. Set mode to "id" to resolve a concrete ID, or
 *         "template" to resolve by rendered name at click time.
 *       oneOf:
 *         - type: object
 *           required: [mode, id]
 *           properties:
 *             mode:
 *               type: string
 *               enum: [id]
 *               description: Target is a single dashboard or log/trace source
 *               example: "id"
 *             id:
 *               type: string
 *               description: ID of the target source (for search) or dashboard (for dashboard).
 *               example: "65f5e4a3b9e77c001a567890"
 *         - type: object
 *           required: [mode, template]
 *           properties:
 *             mode:
 *               type: string
 *               enum: [template]
 *               description: Target is matched by name against the template.
 *               example: "template"
 *             template:
 *               type: string
 *               minLength: 1
 *               description: >
 *                 Name template rendered against the clicked row; supports
 *                 `{{column}}` variables.
 *               example: "{{ServiceName}}"
 *       discriminator:
 *         propertyName: mode
 *
 *     OnClickSearch:
 *       type: object
 *       required: [type, target]
 *       description: Link-out that navigates to the HyperDX search view.
 *       properties:
 *         type:
 *           type: string
 *           enum: [search]
 *           description: OnClick variant discriminator. Must be "search" for search link-outs.
 *           example: "search"
 *         target:
 *           $ref: '#/components/schemas/OnClickTarget'
 *           description: The source to navigate to.
 *         whereTemplate:
 *           type: string
 *           description: Optional WHERE clause template applied to the destination search.
 *           example: "ServiceName = '{{ServiceName}}'"
 *         whereLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           description: Language of the rendered whereTemplate.
 *         filters:
 *           type: array
 *           description: Optional dashboard filter templates rendered against the clicked row.
 *           items:
 *             $ref: '#/components/schemas/OnClickFilterTemplate'
 *
 *     OnClickDashboard:
 *       type: object
 *       required: [type, target]
 *       description: Link-out that navigates to a HyperDX dashboard.
 *       properties:
 *         type:
 *           type: string
 *           enum: [dashboard]
 *           description: OnClick variant discriminator. Must be "dashboard" for dashboard link-outs.
 *           example: "dashboard"
 *         target:
 *           $ref: '#/components/schemas/OnClickTarget'
 *           description: The dashboard to navigate to.
 *         whereTemplate:
 *           type: string
 *           description: Optional WHERE clause template applied to the destination dashboard.
 *           example: "ServiceName = '{{ServiceName}}'"
 *         whereLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           description: Language of the rendered whereTemplate.
 *         filters:
 *           type: array
 *           description: Optional dashboard filter templates rendered against the clicked row.
 *           items:
 *             $ref: '#/components/schemas/OnClickFilterTemplate'
 *
 *     OnClickExternal:
 *       type: object
 *       required: [type, urlTemplate]
 *       description: >
 *         Link-out that navigates to an arbitrary external URL (e.g. a Grafana
 *         or Langfuse dashboard). The rendered URL must be an absolute http(s) URL.
 *       properties:
 *         type:
 *           type: string
 *           enum: [external]
 *           description: OnClick variant discriminator. Must be "external" for external link-outs.
 *           example: "external"
 *         urlTemplate:
 *           type: string
 *           minLength: 1
 *           description: >
 *             Handlebars template rendered against the clicked row; supports
 *             `{{column}}` variables. The rendered value must be an absolute
 *             http(s) URL.
 *           example: "https://example.com/d/abc?var-service={{ServiceName}}"
 *
 *     OnClick:
 *       description: >
 *         Link-out configuration applied when a user clicks a row of a table tile.
 *         Only table tiles (builder or raw SQL) currently support onClick. When
 *         target.mode is "id", the referenced source (type=search) or dashboard
 *         (type=dashboard) must already exist for the team.
 *       oneOf:
 *         - $ref: '#/components/schemas/OnClickSearch'
 *         - $ref: '#/components/schemas/OnClickDashboard'
 *         - $ref: '#/components/schemas/OnClickExternal'
 *       discriminator:
 *         propertyName: type
 *         mapping:
 *           search: '#/components/schemas/OnClickSearch'
 *           dashboard: '#/components/schemas/OnClickDashboard'
 *           external: '#/components/schemas/OnClickExternal'
 *
 *     TableChartConfig:
 *       description: >
 *         Table chart. Omit configType for the builder variant (requires sourceId
 *         and select). Set configType to "sql" for the Raw SQL variant (requires
 *         connectionId and sqlTemplate).
 *       oneOf:
 *         - $ref: '#/components/schemas/TableBuilderChartConfig'
 *         - $ref: '#/components/schemas/TableRawSqlChartConfig'
 *       discriminator:
 *         propertyName: configType
 *         mapping:
 *           sql: '#/components/schemas/TableRawSqlChartConfig'
 *
 *     NumberChartConfig:
 *       description: >
 *         Single big-number chart. Omit configType for the builder variant
 *         (requires sourceId and select). Set configType to "sql" for the Raw
 *         SQL variant (requires connectionId and sqlTemplate).
 *       oneOf:
 *         - $ref: '#/components/schemas/NumberBuilderChartConfig'
 *         - $ref: '#/components/schemas/NumberRawSqlChartConfig'
 *       discriminator:
 *         propertyName: configType
 *         mapping:
 *           sql: '#/components/schemas/NumberRawSqlChartConfig'
 *
 *     PieChartConfig:
 *       description: >
 *         Pie chart. Omit configType for the builder variant (requires sourceId
 *         and select). Set configType to "sql" for the Raw SQL variant (requires
 *         connectionId and sqlTemplate).
 *       oneOf:
 *         - $ref: '#/components/schemas/PieBuilderChartConfig'
 *         - $ref: '#/components/schemas/PieRawSqlChartConfig'
 *       discriminator:
 *         propertyName: configType
 *         mapping:
 *           sql: '#/components/schemas/PieRawSqlChartConfig'
 *
 *     TileConfig:
 *       description: >
 *         Tile chart configuration. displayType is the primary discriminant and
 *         determines which variant group applies. For displayTypes that support
 *         both builder and Raw SQL modes (line, stacked_bar, table, number, pie),
 *         configType is the secondary discriminant: omit it for the builder
 *         variant or set it to "sql" for the Raw SQL variant. The heatmap,
 *         search, and markdown displayTypes only have a builder variant.
 *       oneOf:
 *         - $ref: '#/components/schemas/LineChartConfig'
 *         - $ref: '#/components/schemas/BarChartConfig'
 *         - $ref: '#/components/schemas/TableChartConfig'
 *         - $ref: '#/components/schemas/NumberChartConfig'
 *         - $ref: '#/components/schemas/PieChartConfig'
 *         - $ref: '#/components/schemas/HeatmapChartConfig'
 *         - $ref: '#/components/schemas/SearchChartConfig'
 *         - $ref: '#/components/schemas/MarkdownChartConfig'
 *       discriminator:
 *         propertyName: displayType
 *         mapping:
 *           line: '#/components/schemas/LineChartConfig'
 *           stacked_bar: '#/components/schemas/BarChartConfig'
 *           table: '#/components/schemas/TableChartConfig'
 *           number: '#/components/schemas/NumberChartConfig'
 *           pie: '#/components/schemas/PieChartConfig'
 *           heatmap: '#/components/schemas/HeatmapChartConfig'
 *           search: '#/components/schemas/SearchChartConfig'
 *           markdown: '#/components/schemas/MarkdownChartConfig'
 *
 *     DashboardContainerTab:
 *       type: object
 *       description: A single tab inside a dashboard container. Tiles join a tab via tabId.
 *       required:
 *         - id
 *         - title
 *       properties:
 *         id:
 *           type: string
 *           minLength: 1
 *           maxLength: 256
 *           description: Unique identifier for the tab within its container.
 *           example: "errors"
 *         title:
 *           type: string
 *           minLength: 1
 *           maxLength: 256
 *           description: Display title for the tab.
 *           example: "Errors"
 *
 *     DashboardContainer:
 *       type: object
 *       description: A grouping container for tiles on a dashboard. Tiles join a container via containerId.
 *       required:
 *         - id
 *         - title
 *         - collapsed
 *       properties:
 *         id:
 *           type: string
 *           minLength: 1
 *           maxLength: 256
 *           description: Unique identifier for the container within the dashboard.
 *           example: "service-health"
 *         title:
 *           type: string
 *           minLength: 1
 *           maxLength: 256
 *           description: Display title for the container.
 *           example: "Service Health"
 *         collapsed:
 *           type: boolean
 *           description: Persisted default collapse state. Per-viewer state lives in the URL.
 *           example: false
 *         collapsible:
 *           type: boolean
 *           description: Whether the user can collapse the group.
 *           default: true
 *           example: true
 *         bordered:
 *           type: boolean
 *           description: Whether to show a visual border around the group.
 *           default: true
 *           example: true
 *         tabs:
 *           type: array
 *           description: Optional tabs. 2+ entries renders a tab bar; 0-1 entries renders a plain group header. Tiles join a tab via tabId.
 *           maxItems: 20
 *           items:
 *             $ref: '#/components/schemas/DashboardContainerTab'
 *
 *     TileBase:
 *       type: object
 *       description: Common fields shared by tile input and output
 *       required:
 *         - name
 *         - x
 *         - y
 *         - w
 *         - h
 *       properties:
 *         name:
 *           type: string
 *           description: Display name for the tile
 *           example: "Error Rate"
 *         x:
 *           type: integer
 *           minimum: 0
 *           maximum: 23
 *           description: Horizontal position in the grid (0-based)
 *           example: 0
 *         y:
 *           type: integer
 *           minimum: 0
 *           description: Vertical position in the grid (0-based)
 *           example: 0
 *         w:
 *           type: integer
 *           minimum: 1
 *           maximum: 24
 *           description: Width in grid units
 *           example: 6
 *         h:
 *           type: integer
 *           minimum: 1
 *           description: Height in grid units
 *           example: 3
 *         config:
 *           $ref: '#/components/schemas/TileConfig'
 *           description: Chart configuration for the tile. The displayType field determines which variant is used. Replaces the deprecated "series" and "asRatio" fields.
 *         containerId:
 *           type: string
 *           minLength: 1
 *           maxLength: 256
 *           description: References a DashboardContainer by id. Tiles without containerId render in the default ungrouped area.
 *           example: "service-health"
 *         tabId:
 *           type: string
 *           minLength: 1
 *           maxLength: 256
 *           description: References a tab inside the tile's container by id. Requires containerId to be set, and the container to declare a matching tab.
 *           example: "errors"
 *
 *     TileOutput:
 *       description: Response format for dashboard tiles
 *       allOf:
 *         - $ref: '#/components/schemas/TileBase'
 *         - type: object
 *           required:
 *             - id
 *           properties:
 *             id:
 *               type: string
 *               maxLength: 36
 *               description: Unique tile ID assigned by the server.
 *               example: "65f5e4a3b9e77c001a901234"
 *
 *     TileInput:
 *       description: >
 *         Input / request format when creating or updating tiles. The id field is
 *         optional: on create it is ignored (the server always assigns a new ID);
 *         on update, a matching id is used to identify the existing tile to
 *         preserve. Tiles whose id does not match an existing tile are assigned
 *         a new generated ID.
 *       allOf:
 *         - $ref: '#/components/schemas/TileBase'
 *         - type: object
 *           properties:
 *             id:
 *               type: string
 *               maxLength: 36
 *               description: Optional tile ID. Omit to generate a new ID.
 *               example: "65f5e4a3b9e77c001a901234"
 *             asRatio:
 *               type: boolean
 *               description: Display two series as a ratio (series[0] / series[1]). Only applicable when providing "series". Deprecated in favor of "config.asRatio".
 *               example: false
 *               deprecated: true
 *             series:
 *               type: array
 *               minItems: 1
 *               description: Data series to display in this tile (all must be the same type). Deprecated; use "config" instead.
 *               deprecated: true
 *               items:
 *                 $ref: '#/components/schemas/DashboardChartSeries'
 *
 *     FilterInput:
 *       type: object
 *       description: Dashboard filter key that can be added to a dashboard
 *       required:
 *         - type
 *         - name
 *         - expression
 *         - sourceId
 *       properties:
 *         type:
 *           type: string
 *           enum: [QUERY_EXPRESSION]
 *           description: Filter type. Must be "QUERY_EXPRESSION".
 *           example: "QUERY_EXPRESSION"
 *         name:
 *           type: string
 *           minLength: 1
 *           description: Display name for the dashboard filter key
 *           example: "Environment"
 *         expression:
 *           type: string
 *           minLength: 1
 *           description: Key expression used when applying this dashboard filter key
 *           example: "environment"
 *         sourceId:
 *           type: string
 *           description: Source ID this dashboard filter key applies to
 *           example: "65f5e4a3b9e77c001a111111"
 *         sourceMetricType:
 *           type: string
 *           enum: [sum, gauge, histogram, summary, exponential histogram]
 *           description: Metric type when source is metrics
 *           example: "gauge"
 *         where:
 *           type: string
 *           description: Optional WHERE condition to scope which rows this filter key reads values from
 *           example: "ServiceName:api"
 *         whereLanguage:
 *           type: string
 *           enum: [sql, lucene]
 *           description: Language of the where condition
 *           default: "sql"
 *           example: "lucene"
 *         appliesToSourceIds:
 *           type: array
 *           items:
 *             type: string
 *           description: |
 *             Optional list of source IDs this filter applies to. Omit or provide
 *             an empty array to apply the filter to ALL tiles regardless of source.
 *             A non-empty array restricts the filter to only tiles whose source ID
 *             is in the list; tiles using other sources are not affected by the
 *             selected filter value(s).
 *           example: ["65f5e4a3b9e77c001a111111"]
 *
 *     Filter:
 *       allOf:
 *         - $ref: '#/components/schemas/FilterInput'
 *         - type: object
 *           required:
 *             - id
 *           properties:
 *             id:
 *               type: string
 *               description: Unique dashboard filter key ID
 *
 *     Dashboard:
 *       type: object
 *       description: Dashboard with tiles and configuration
 *       properties:
 *         id:
 *           type: string
 *           description: Dashboard ID
 *           example: "65f5e4a3b9e77c001a567890"
 *         name:
 *           type: string
 *           description: Dashboard name
 *           maxLength: 1024
 *           example: "Service Overview"
 *         tiles:
 *           type: array
 *           description: List of tiles/charts in the dashboard
 *           items:
 *             $ref: '#/components/schemas/TileOutput'
 *         tags:
 *           type: array
 *           description: Tags for organizing and filtering dashboards
 *           items:
 *             type: string
 *             maxLength: 32
 *           maxItems: 50
 *           example: ["production", "monitoring"]
 *         filters:
 *           type: array
 *           description: Dashboard filter keys added to the dashboard and applied to all tiles
 *           items:
 *             $ref: '#/components/schemas/Filter'
 *         savedQuery:
 *           type: string
 *           nullable: true
 *           description: Optional default dashboard query restored when loading the dashboard.
 *           example: "service.name = 'api'"
 *         savedQueryLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           nullable: true
 *           description: Query language used by savedQuery.
 *           default: "lucene"
 *           example: "sql"
 *         savedFilterValues:
 *           type: array
 *           description: Optional default dashboard filter values restored when loading the dashboard.
 *           items:
 *             $ref: '#/components/schemas/SavedFilterValue'
 *         containers:
 *           type: array
 *           description: Optional grouping containers. Each tile may join a container via tile.containerId, and a tab inside it via tile.tabId.
 *           maxItems: 50
 *           items:
 *             $ref: '#/components/schemas/DashboardContainer'
 *
 *     CreateDashboardRequest:
 *       type: object
 *       required:
 *         - name
 *         - tiles
 *       properties:
 *         name:
 *           type: string
 *           maxLength: 1024
 *           description: Dashboard name.
 *           example: "New Dashboard"
 *         tiles:
 *           type: array
 *           description: List of tiles/charts to include in the dashboard.
 *           maxItems: 500
 *           items:
 *             $ref: '#/components/schemas/TileInput'
 *         tags:
 *           type: array
 *           description: Tags for organizing and filtering dashboards.
 *           items:
 *             type: string
 *             maxLength: 32
 *           maxItems: 50
 *           example: ["development"]
 *         filters:
 *           type: array
 *           description: Dashboard filter keys to add to the dashboard and apply across all tiles
 *           items:
 *             $ref: '#/components/schemas/FilterInput'
 *         savedQuery:
 *           type: string
 *           nullable: true
 *           description: Optional default dashboard query to persist on the dashboard.
 *           example: "service.name = 'api'"
 *         savedQueryLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           nullable: true
 *           description: Query language used by savedQuery.
 *           default: "lucene"
 *           example: "sql"
 *         savedFilterValues:
 *           type: array
 *           description: Optional default dashboard filter values to persist on the dashboard.
 *           items:
 *             $ref: '#/components/schemas/SavedFilterValue'
 *         containers:
 *           type: array
 *           description: Optional grouping containers. Each tile may join a container via tile.containerId, and a tab inside it via tile.tabId.
 *           maxItems: 50
 *           items:
 *             $ref: '#/components/schemas/DashboardContainer'
 *
 *     UpdateDashboardRequest:
 *       type: object
 *       required:
 *         - name
 *         - tiles
 *       properties:
 *         name:
 *           type: string
 *           maxLength: 1024
 *           description: Dashboard name.
 *           example: "Updated Dashboard Name"
 *         tiles:
 *           type: array
 *           maxItems: 500
 *           items:
 *             $ref: '#/components/schemas/TileInput'
 *           description: Full list of tiles for the dashboard. Existing tiles are matched by ID; tiles with an ID that does not match an existing tile will be assigned a new generated ID.
 *         tags:
 *           type: array
 *           description: Tags for organizing and filtering dashboards.
 *           items:
 *             type: string
 *             maxLength: 32
 *           maxItems: 50
 *           example: ["production", "updated"]
 *         filters:
 *           type: array
 *           description: Dashboard filter keys on the dashboard, applied across all tiles
 *           items:
 *             $ref: '#/components/schemas/Filter'
 *         savedQuery:
 *           type: string
 *           nullable: true
 *           description: Optional default dashboard query to persist on the dashboard.
 *           example: "service.name = 'api'"
 *         savedQueryLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           nullable: true
 *           description: Query language used by savedQuery.
 *           default: "lucene"
 *           example: "sql"
 *         savedFilterValues:
 *           type: array
 *           description: Optional default dashboard filter values to persist on the dashboard.
 *           items:
 *             $ref: '#/components/schemas/SavedFilterValue'
 *         containers:
 *           type: array
 *           description: Optional grouping containers. Each tile may join a container via tile.containerId, and a tab inside it via tile.tabId.
 *           maxItems: 50
 *           items:
 *             $ref: '#/components/schemas/DashboardContainer'
 *
 *     DashboardResponse:
 *       allOf:
 *         - $ref: '#/components/schemas/Dashboard'
 *
 *     DashboardResponseEnvelope:
 *       type: object
 *       properties:
 *         data:
 *           $ref: '#/components/schemas/DashboardResponse'
 *           description: The dashboard object.
 *
 *     DashboardsListResponse:
 *       type: object
 *       properties:
 *         data:
 *           type: array
 *           description: List of dashboard objects.
 *           items:
 *             $ref: '#/components/schemas/DashboardResponse'
 */

const router = express.Router();

/**
 * @openapi
 * /api/v2/dashboards:
 *   get:
 *     summary: List Dashboards
 *     description: Retrieves a list of all dashboards for the authenticated team
 *     operationId: listDashboards
 *     tags: [Dashboards]
 *     responses:
 *       '200':
 *         description: Successfully retrieved dashboards
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardsListResponse'
 *             examples:
 *               dashboards:
 *                 summary: Dashboards list response
 *                 value:
 *                   data:
 *                     - id: "65f5e4a3b9e77c001a567890"
 *                       name: "Infrastructure Monitoring"
 *                       tiles:
 *                         - id: "65f5e4a3b9e77c001a901234"
 *                           name: "Server CPU"
 *                           x: 0
 *                           y: 0
 *                           w: 6
 *                           h: 3
 *                           config:
 *                             displayType: "line"
 *                             sourceId: "65f5e4a3b9e77c001a111111"
 *                             select:
 *                               - aggFn: "avg"
 *                                 valueExpression: "cpu.usage"
 *                                 where: "host:server-01"
 *                       tags: ["infrastructure", "monitoring"]
 *                       filters:
 *                         - id: "65f5e4a3b9e77c001a301001"
 *                           type: "QUERY_EXPRESSION"
 *                           name: "Environment"
 *                           expression: "environment"
 *                           sourceId: "65f5e4a3b9e77c001a111111"
 *                     - id: "65f5e4a3b9e77c001a567891"
 *                       name: "API Monitoring"
 *                       tiles:
 *                         - id: "65f5e4a3b9e77c001a901235"
 *                           name: "API Errors"
 *                           x: 0
 *                           y: 0
 *                           w: 6
 *                           h: 3
 *                           config:
 *                             displayType: "table"
 *                             sourceId: "65f5e4a3b9e77c001a111112"
 *                             select:
 *                               - aggFn: "count"
 *                                 where: "level:error"
 *                             groupBy: "service"
 *                             orderBy: "count DESC"
 *                       tags: ["api", "monitoring"]
 *                       filters:
 *                         - id: "65f5e4a3b9e77c001a301002"
 *                           type: "QUERY_EXPRESSION"
 *                           name: "Service"
 *                           expression: "service_name"
 *                           sourceId: "65f5e4a3b9e77c001a111112"
 *       '401':
 *         description: Unauthorized
 */
router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }

    const dashboards = await Dashboard.find(
      { team: teamId },
      EXTERNAL_DASHBOARD_PROJECTION,
    ).sort({ name: -1 });

    res.json({
      data: dashboards.map(d => convertToExternalDashboard(d)),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/v2/dashboards/{id}:
 *   get:
 *     summary: Get Dashboard
 *     description: Retrieves a specific dashboard by ID
 *     operationId: getDashboard
 *     tags: [Dashboards]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Dashboard ID
 *         example: "65f5e4a3b9e77c001a567890"
 *     responses:
 *       '200':
 *         description: Successfully retrieved dashboard
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardResponseEnvelope'
 *             examples:
 *               dashboard:
 *                 summary: Single dashboard response
 *                 value:
 *                   data:
 *                     id: "65f5e4a3b9e77c001a567890"
 *                     name: "Infrastructure Monitoring"
 *                     tiles:
 *                       - id: "65f5e4a3b9e77c001a901234"
 *                         name: "Server CPU"
 *                         x: 0
 *                         y: 0
 *                         w: 6
 *                         h: 3
 *                         config:
 *                           displayType: "line"
 *                           sourceId: "65f5e4a3b9e77c001a111111"
 *                           select:
 *                             - aggFn: "avg"
 *                               valueExpression: "cpu.usage"
 *                               where: "host:server-01"
 *                       - id: "65f5e4a3b9e77c001a901235"
 *                         name: "Memory Usage"
 *                         x: 6
 *                         y: 0
 *                         w: 6
 *                         h: 3
 *                         config:
 *                           displayType: "line"
 *                           sourceId: "65f5e4a3b9e77c001a111111"
 *                           select:
 *                             - aggFn: "avg"
 *                               valueExpression: "memory.usage"
 *                               where: "host:server-01"
 *                     tags: ["infrastructure", "monitoring"]
 *                     filters:
 *                       - id: "65f5e4a3b9e77c001a301003"
 *                         type: "QUERY_EXPRESSION"
 *                         name: "Environment"
 *                         expression: "environment"
 *                         sourceId: "65f5e4a3b9e77c001a111111"
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Unauthorized access. API key is missing or invalid."
 *       '404':
 *         description: Dashboard not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Dashboard not found"
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
        return res.sendStatus(403);
      }

      const dashboard = await Dashboard.findOne(
        { team: teamId, _id: req.params.id },
        EXTERNAL_DASHBOARD_PROJECTION,
      );

      if (dashboard == null) {
        return res.sendStatus(404);
      }

      res.json({
        data: convertToExternalDashboard(dashboard),
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/v2/dashboards:
 *   post:
 *     summary: Create Dashboard
 *     description: Creates a new dashboard
 *     operationId: createDashboard
 *     tags: [Dashboards]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateDashboardRequest'
 *           examples:
 *             simpleTimeSeriesDashboard:
 *               summary: Dashboard with a line chart
 *               value:
 *                 name: "API Monitoring Dashboard"
 *                 tiles:
 *                   - name: "API Request Volume"
 *                     x: 0
 *                     y: 0
 *                     w: 6
 *                     h: 3
 *                     config:
 *                       displayType: "line"
 *                       sourceId: "65f5e4a3b9e77c001a111111"
 *                       select:
 *                         - aggFn: "count"
 *                           where: "service:api"
 *                 tags: ["api", "monitoring"]
 *                 filters:
 *                   - type: "QUERY_EXPRESSION"
 *                     name: "Environment"
 *                     expression: "environment"
 *                     sourceId: "65f5e4a3b9e77c001a111111"
 *             complexDashboard:
 *               summary: Dashboard with multiple chart types
 *               value:
 *                 name: "Service Health Overview"
 *                 tiles:
 *                   - name: "Request Count"
 *                     x: 0
 *                     y: 0
 *                     w: 6
 *                     h: 3
 *                     config:
 *                       displayType: "line"
 *                       sourceId: "65f5e4a3b9e77c001a111111"
 *                       select:
 *                         - aggFn: "count"
 *                           where: "service:backend"
 *                   - name: "Error Distribution"
 *                     x: 6
 *                     y: 0
 *                     w: 6
 *                     h: 3
 *                     config:
 *                       displayType: "table"
 *                       sourceId: "65f5e4a3b9e77c001a111111"
 *                       select:
 *                         - aggFn: "count"
 *                           where: "level:error"
 *                       groupBy: "errorType"
 *                       orderBy: "count DESC"
 *                 tags: ["service-health", "production"]
 *                 filters:
 *                   - type: "QUERY_EXPRESSION"
 *                     name: "Service"
 *                     expression: "service_name"
 *                     sourceId: "65f5e4a3b9e77c001a111111"
 *     responses:
 *       '200':
 *         description: Successfully created dashboard
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardResponseEnvelope'
 *             examples:
 *               createdDashboard:
 *                 summary: Created dashboard response
 *                 value:
 *                   data:
 *                     id: "65f5e4a3b9e77c001a567890"
 *                     name: "API Monitoring Dashboard"
 *                     tiles:
 *                       - id: "65f5e4a3b9e77c001a901234"
 *                         name: "API Request Volume"
 *                         x: 0
 *                         y: 0
 *                         w: 6
 *                         h: 3
 *                         config:
 *                           displayType: "line"
 *                           sourceId: "65f5e4a3b9e77c001a111111"
 *                           select:
 *                             - aggFn: "count"
 *                               where: "service:api"
 *                     tags: ["api", "monitoring"]
 *                     filters:
 *                       - id: "65f5e4a3b9e77c001a301004"
 *                         type: "QUERY_EXPRESSION"
 *                         name: "Environment"
 *                         expression: "environment"
 *                         sourceId: "65f5e4a3b9e77c001a111111"
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Unauthorized access. API key is missing or invalid."
 *       '400':
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Could not find the following source IDs: 68fa86308aa879b977aa6af6"
 *       '500':
 *         description: Server error or validation failure
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Dashboard validation failed: name is required"
 */
router.post(
  '/',
  validateRequest({
    body: createDashboardBodySchema,
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const {
        name,
        tiles,
        tags,
        filters,
        savedQuery,
        savedQueryLanguage,
        savedFilterValues,
        containers,
      } = req.body;

      const validationError = await validateDashboardTiles({
        teamId: teamId.toString(),
        tiles,
        filters,
        containers: containers ?? [],
      });
      if (validationError) {
        return res.status(400).json({ message: validationError });
      }

      const internalTiles = convertExternalTilesToInternal(tiles);
      const filtersWithIds = convertExternalFiltersToInternal(filters || []);

      const normalizedSavedQueryLanguage = resolveSavedQueryLanguage({
        savedQuery,
        savedQueryLanguage,
      });

      const newDashboard = await new Dashboard({
        name,
        tiles: internalTiles,
        tags: tags && uniq(tags),
        filters: filtersWithIds,
        savedQuery,
        savedQueryLanguage: normalizedSavedQueryLanguage,
        savedFilterValues,
        team: teamId,
        ...(containers !== undefined ? { containers } : {}),
      }).save();

      res.json({
        data: convertToExternalDashboard(newDashboard),
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/v2/dashboards/{id}:
 *   put:
 *     summary: Update Dashboard
 *     description: |
 *       Updates an existing dashboard.
 *
 *       **Concurrency:** This endpoint does not support optimistic
 *       concurrency control. Concurrent PUT requests for the same
 *       dashboard may silently overwrite each other, which can leave
 *       orphan tile-to-container references on layout-shape edits.
 *       Clients should serialize edits to a given dashboard.
 *     operationId: updateDashboard
 *     tags: [Dashboards]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Dashboard ID
 *         example: "65f5e4a3b9e77c001a567890"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateDashboardRequest'
 *           examples:
 *             updateDashboard:
 *               summary: Update dashboard properties and tiles
 *               value:
 *                 name: "Updated Dashboard Name"
 *                 tiles:
 *                   - id: "65f5e4a3b9e77c001a901234"
 *                     name: "Updated Line Chart"
 *                     x: 0
 *                     y: 0
 *                     w: 6
 *                     h: 3
 *                     config:
 *                       displayType: "line"
 *                       sourceId: "65f5e4a3b9e77c001a111111"
 *                       select:
 *                         - aggFn: "count"
 *                           where: "level:error"
 *                   - id: "new-tile-123"
 *                     name: "New Number Chart"
 *                     x: 6
 *                     y: 0
 *                     w: 6
 *                     h: 3
 *                     config:
 *                       displayType: "number"
 *                       sourceId: "65f5e4a3b9e77c001a111111"
 *                       select:
 *                         - aggFn: "count"
 *                           where: "level:info"
 *                 tags: ["production", "updated"]
 *                 filters:
 *                   - id: "65f5e4a3b9e77c001a301005"
 *                     type: "QUERY_EXPRESSION"
 *                     name: "Environment"
 *                     expression: "environment"
 *                     sourceId: "65f5e4a3b9e77c001a111111"
 *     responses:
 *       '200':
 *         description: Successfully updated dashboard
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardResponseEnvelope'
 *             examples:
 *               updatedDashboard:
 *                 summary: Updated dashboard response
 *                 value:
 *                   data:
 *                     id: "65f5e4a3b9e77c001a567890"
 *                     name: "Updated Dashboard Name"
 *                     tiles:
 *                       - id: "65f5e4a3b9e77c001a901234"
 *                         name: "Updated Line Chart"
 *                         x: 0
 *                         y: 0
 *                         w: 6
 *                         h: 3
 *                         config:
 *                           displayType: "line"
 *                           sourceId: "65f5e4a3b9e77c001a111111"
 *                           select:
 *                             - aggFn: "count"
 *                               where: "level:error"
 *                       - id: "new-tile-123"
 *                         name: "New Number Chart"
 *                         x: 6
 *                         y: 0
 *                         w: 6
 *                         h: 3
 *                         config:
 *                           displayType: "number"
 *                           sourceId: "65f5e4a3b9e77c001a111111"
 *                           select:
 *                             - aggFn: "count"
 *                               where: "level:info"
 *                     tags: ["production", "updated"]
 *                     filters:
 *                       - id: "65f5e4a3b9e77c001a301005"
 *                         type: "QUERY_EXPRESSION"
 *                         name: "Environment"
 *                         expression: "environment"
 *                         sourceId: "65f5e4a3b9e77c001a111111"
 *       '400':
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Could not find the following source IDs: 68fa86308aa879b977aa6af6"
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Unauthorized access. API key is missing or invalid."
 *       '404':
 *         description: Dashboard not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Dashboard not found"
 *       '500':
 *         description: Server error or validation failure
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Invalid dashboard configuration"
 */
router.put(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    body: updateDashboardBodySchema,
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const { id: dashboardId } = req.params;
      if (teamId == null) {
        return res.sendStatus(403);
      }
      if (!dashboardId) {
        return res.sendStatus(400);
      }

      const {
        name,
        tiles,
        tags,
        filters,
        savedQuery,
        savedQueryLanguage,
        savedFilterValues,
        containers,
      } = req.body ?? {};

      const existingDashboard = await Dashboard.findOne(
        { _id: dashboardId, team: teamId },
        { tiles: 1, filters: 1, containers: 1 },
      ).lean();

      if (existingDashboard == null) {
        return res.sendStatus(404);
      }

      const effectiveContainers =
        containers ?? existingDashboard.containers ?? [];
      const validationError = await validateDashboardTiles({
        teamId: teamId.toString(),
        tiles,
        filters,
        existingTiles: existingDashboard.tiles ?? [],
        containers: effectiveContainers,
      });
      if (validationError) {
        return res.status(400).json({ message: validationError });
      }

      const existingTileIds = new Set(
        (existingDashboard.tiles ?? []).map((t: { id: string }) => t.id),
      );
      const existingFilterIds = new Set(
        (existingDashboard.filters ?? []).map((f: { id: string }) => f.id),
      );

      const internalTiles = convertExternalTilesToInternal(
        tiles,
        existingTileIds,
      );

      // Typed as `Partial<IDashboard>` (the canonical Mongo doc shape) so
      // that misnamed or wrong-shape fields fail at compile time. The
      // legacy `Record<string, unknown>` accepted anything.
      const setPayload: Partial<IDashboard> = {
        name,
        tiles: internalTiles,
        tags: tags && uniq(tags),
      };
      if (filters !== undefined) {
        setPayload.filters = convertExternalFiltersToInternal(
          filters,
          existingFilterIds,
        );
      }
      if (savedQuery !== undefined) {
        setPayload.savedQuery = savedQuery;
      }
      const normalizedSavedQueryLanguage = resolveSavedQueryLanguage({
        savedQuery,
        savedQueryLanguage,
      });
      if (normalizedSavedQueryLanguage !== undefined) {
        setPayload.savedQueryLanguage = normalizedSavedQueryLanguage;
      }
      if (savedFilterValues !== undefined) {
        setPayload.savedFilterValues = savedFilterValues;
      }
      if (containers !== undefined) {
        setPayload.containers = containers;
      }

      const updatedDashboard = await Dashboard.findOneAndUpdate(
        { _id: dashboardId, team: teamId },
        { $set: setPayload },
        { new: true },
      );

      if (updatedDashboard == null) {
        return res.sendStatus(404);
      }

      await cleanupDashboardAlerts({
        dashboardId,
        teamId,
        internalTiles,
        existingTileIds,
      });

      res.json({
        data: convertToExternalDashboard(updatedDashboard),
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/v2/dashboards/{id}:
 *   delete:
 *     summary: Delete Dashboard
 *     description: Deletes a dashboard
 *     operationId: deleteDashboard
 *     tags: [Dashboards]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Dashboard ID
 *         example: "65f5e4a3b9e77c001a567890"
 *     responses:
 *       '200':
 *         description: Successfully deleted dashboard
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
 *       '404':
 *         description: Dashboard not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Dashboard not found"
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
      const { id: dashboardId } = req.params;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      await deleteDashboard(dashboardId, teamId);

      res.json({});
    } catch (e) {
      next(e);
    }
  },
);

export default router;
