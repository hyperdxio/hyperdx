import { SourceKind } from '@berg/common-utils/dist/types';
import mongoose, { Schema } from 'mongoose';

// Berg `Source` is a single Athena/Iceberg table descriptor. The four
// HyperDX kinds (Log/Trace/Session/Metric) have collapsed into one.
//
// `ISource` is the in-DB document shape. `ISourceInput` is the create/update
// shape (allows team as either ObjectId or string for ergonomic access from
// controllers).

export interface ISource {
  team: mongoose.Types.ObjectId;
  kind: 'Table';
  name?: string;
  catalog: string;
  database: string;
  table: string;
  displayName: string;
  timestampColumn?: string;
  defaultSort?: string;
  defaultColumns?: string[];
  lastQueriedAt?: Date;
  querySettings?: { setting: string; value: string }[];
}

export type ISourceInput = Omit<ISource, 'team'> & {
  team: mongoose.Types.ObjectId | string;
};

export type SourceDocument = mongoose.HydratedDocument<ISource>;

const sourceSchema = new Schema<ISource>(
  {
    kind: {
      type: String,
      enum: [SourceKind.Table],
      required: true,
      default: SourceKind.Table,
    },
    team: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Team',
    },
    name: String,
    catalog: { type: String, required: true, minlength: 1 },
    database: { type: String, required: true, minlength: 1 },
    table: { type: String, required: true, minlength: 1 },
    displayName: { type: String, required: true, minlength: 1 },
    timestampColumn: String,
    defaultSort: String,
    defaultColumns: [String],
    lastQueriedAt: Date,
    querySettings: {
      type: [
        new Schema(
          {
            setting: { type: String, required: true, minlength: 1 },
            value: { type: String, required: true, minlength: 1 },
          },
          { _id: false },
        ),
      ],
      validate: {
        validator: (value: unknown[]) => value.length <= 10,
        message: '{PATH} exceeds the limit of 10',
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  },
);

export const Source = mongoose.model<ISource>('Source', sourceSchema);
