import {
  MetricsDataType,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import mongoose, { Schema } from 'mongoose';

type ObjectId = mongoose.Types.ObjectId;

export interface ISource extends Omit<TSource, 'connection'> {
  team: ObjectId;
  connection: ObjectId | string;
}

export type SourceDocument = mongoose.HydratedDocument<ISource>;

export const Source = mongoose.model<ISource>(
  'Source',
  new Schema<ISource>(
    {
      kind: {
        type: String,
        enum: Object.values(SourceKind),
        required: true,
      },
      team: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Team',
      },
      from: {
        databaseName: String,
        tableName: String,
      },
      timestampValueExpression: String,
      connection: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Connection',
      },

      name: String,
      displayedTimestampValueExpression: String,
      implicitColumnExpression: String,
      serviceNameExpression: String,
      bodyExpression: String,
      tableFilterExpression: String,
      eventAttributesExpression: String,
      resourceAttributesExpression: String,
      defaultTableSelectExpression: String,
      uniqueRowIdExpression: String,
      severityTextExpression: String,
      traceIdExpression: String,
      spanIdExpression: String,
      traceSourceId: String,
      sessionSourceId: String,
      metricSourceId: String,

      durationExpression: String,
      durationPrecision: Number,
      parentSpanIdExpression: String,
      spanNameExpression: String,

      logSourceId: String,
      spanKindExpression: String,
      statusCodeExpression: String,
      statusMessageExpression: String,
      spanEventsValueExpression: String,

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
    },
    {
      toJSON: { virtuals: true },
      timestamps: true,
    },
  ),
);
