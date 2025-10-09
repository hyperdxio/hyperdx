import {
  LogSourceSchema,
  MetricsDataType,
  MetricSourceSchema,
  SessionSourceSchema,
  SourceKind,
  TraceSourceSchema,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import mongoose, { Schema } from 'mongoose';
import { z } from 'zod';

import { objectIdSchema } from '@/utils/zod';

const sourceExtension = {
  team: objectIdSchema.or(z.instanceof(mongoose.Types.ObjectId)),
  connection: objectIdSchema.or(z.instanceof(mongoose.Types.ObjectId)),
};
const SourceModelSchema = z.discriminatedUnion('kind', [
  LogSourceSchema.extend(sourceExtension),
  TraceSourceSchema.extend(sourceExtension),
  SessionSourceSchema.extend(sourceExtension),
  MetricSourceSchema.extend(sourceExtension),
]);
export type ISource = z.infer<typeof SourceModelSchema>;
export type SourceDocument = mongoose.HydratedDocument<ISource>;

export const Source = mongoose.model<ISource>(
  'Source',
  new Schema<ISource>({
    name: String,
    kind: {
      type: String,
      enum: Object.values(SourceKind),
      required: true,
    },
    from: {
      databaseName: String,
      tableName: String,
    },
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
  }),
);

export const LogSource = Source.discriminator<
  Extract<TSource, { kind: SourceKind.Log }>
>(
  SourceKind.Log,
  new mongoose.Schema<Extract<TSource, { kind: SourceKind.Log }>>({
    timestampValueExpression: String,
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
  }),
);

export const TraceSource = Source.discriminator<
  Extract<TSource, { kind: SourceKind.Trace }>
>(
  SourceKind.Trace,
  new mongoose.Schema<Extract<TSource, { kind: SourceKind.Trace }>>({
    defaultTableSelectExpression: String,
    timestampValueExpression: String,
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
  }),
);

export const MetricSource = Source.discriminator<
  Extract<TSource, { kind: SourceKind.Metric }>
>(
  SourceKind.Metric,
  new mongoose.Schema<Extract<TSource, { kind: SourceKind.Metric }>>({
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
    timestampValueExpression: String,
    resourceAttributesExpression: String,
    logSourceId: String,
  }),
);

export const SessionSource = Source.discriminator<
  Extract<TSource, { kind: SourceKind.Session }>
>(
  SourceKind.Session,
  new mongoose.Schema<Extract<TSource, { kind: SourceKind.Session }>>({
    traceSourceId: String,
    timestampValueExpression: String,
  }),
);
