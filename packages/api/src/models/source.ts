import {
  LogSourceSchema,
  MetricsDataType,
  MetricSourceSchema,
  SessionSourceSchema,
  SourceBaseSchema,
  SourceKind,
  TraceSourceSchema,
} from '@hyperdx/common-utils/dist/types';
import mongoose, { Schema } from 'mongoose';
import z from 'zod';

import { objectIdSchema } from '@/utils/zod';

// ISource is a discriminated union (inherits from TSource) with team added
// and connection widened to ObjectId | string for Mongoose.
// Omit and & distribute over the union, preserving the discriminated structure.
export const ISourceSchema = z.discriminatedUnion('kind', [
  LogSourceSchema.omit({ connection: true }).extend({
    team: objectIdSchema,
    connection: objectIdSchema.or(z.string()),
  }),
  TraceSourceSchema.omit({ connection: true }).extend({
    team: objectIdSchema,
    connection: objectIdSchema.or(z.string()),
  }),
  SessionSourceSchema.omit({ connection: true }).extend({
    team: objectIdSchema,
    connection: objectIdSchema.or(z.string()),
  }),
  MetricSourceSchema.omit({ connection: true }).extend({
    team: objectIdSchema,
    connection: objectIdSchema.or(z.string()),
  }),
]);
export type ISource = z.infer<typeof ISourceSchema>;

export type SourceDocument = mongoose.HydratedDocument<ISource>;

// --------------------------
// Base schema (common fields shared by all source kinds)
// --------------------------

type MongooseSourceBase = Omit<
  z.infer<typeof SourceBaseSchema>,
  'connection'
> & {
  team: mongoose.Types.ObjectId;
  connection: mongoose.Types.ObjectId;
};

const sourceBaseSchema = new Schema<MongooseSourceBase>(
  {
    team: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Team',
    },
    connection: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Connection',
    },
    name: String,
    from: {
      databaseName: String,
      tableName: String,
    },
    timestampValueExpression: String,
    querySettings: {
      type: [
        {
          setting: { type: String, required: true, minlength: 1 },
          value: { type: String, required: true, minlength: 1 },
        },
      ],
      maxlength: 10,
    },
  },
  {
    discriminatorKey: 'kind',
    toJSON: { virtuals: true },
    timestamps: true,
  },
);

// Model is typed with the base schema type internally. Consumers use ISource
// (the discriminated union) via the exported type and discriminator models.
const SourceModel = mongoose.model<MongooseSourceBase>(
  'Source',
  sourceBaseSchema,
);
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
export const Source = SourceModel as unknown as mongoose.Model<ISource>;

// --------------------------
// Log discriminator
// --------------------------
export const LogSource = Source.discriminator(
  SourceKind.Log,
  new Schema({
    defaultTableSelectExpression: String,
    serviceNameExpression: String,
    severityTextExpression: String,
    bodyExpression: String,
    eventAttributesExpression: String,
    resourceAttributesExpression: String,
    displayedTimestampValueExpression: String,
    metricSourceId: String,
    traceSourceId: String,
    traceIdExpression: String,
    spanIdExpression: String,
    implicitColumnExpression: String,
    uniqueRowIdExpression: String,
    tableFilterExpression: String,
    highlightedTraceAttributeExpressions: {
      type: mongoose.Schema.Types.Array,
    },
    highlightedRowAttributeExpressions: {
      type: mongoose.Schema.Types.Array,
    },
    materializedViews: {
      type: mongoose.Schema.Types.Array,
    },
    orderByExpression: String,
  }),
);

// --------------------------
// Trace discriminator
// --------------------------
export const TraceSource = Source.discriminator(
  SourceKind.Trace,
  new Schema({
    defaultTableSelectExpression: String,
    durationExpression: String,
    durationPrecision: Number,
    traceIdExpression: String,
    spanIdExpression: String,
    parentSpanIdExpression: String,
    spanNameExpression: String,
    spanKindExpression: String,
    logSourceId: String,
    sessionSourceId: String,
    metricSourceId: String,
    statusCodeExpression: String,
    statusMessageExpression: String,
    serviceNameExpression: String,
    resourceAttributesExpression: String,
    eventAttributesExpression: String,
    spanEventsValueExpression: String,
    implicitColumnExpression: String,
    displayedTimestampValueExpression: String,
    highlightedTraceAttributeExpressions: {
      type: mongoose.Schema.Types.Array,
    },
    highlightedRowAttributeExpressions: {
      type: mongoose.Schema.Types.Array,
    },
    materializedViews: {
      type: mongoose.Schema.Types.Array,
    },
    orderByExpression: String,
  }),
);

// --------------------------
// Session discriminator
// --------------------------
export const SessionSource = Source.discriminator(
  SourceKind.Session,
  new Schema({
    traceSourceId: String,
    resourceAttributesExpression: String,
  }),
);

// --------------------------
// Metric discriminator
// --------------------------
export const MetricSource = Source.discriminator(
  SourceKind.Metric,
  new Schema({
    metricTables: {
      type: {
        [MetricsDataType.Gauge]: String,
        [MetricsDataType.Histogram]: String,
        [MetricsDataType.Sum]: String,
        [MetricsDataType.Summary]: String,
        [MetricsDataType.ExponentialHistogram]: String,
      },
      default: undefined,
    },
    resourceAttributesExpression: String,
    serviceNameExpression: String,
    logSourceId: String,
  }),
);
