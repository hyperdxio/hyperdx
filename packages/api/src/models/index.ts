import mongoose from 'mongoose';

import * as config from '@/config';
import { getCounter } from '@/utils/instrumentation';
import logger from '@/utils/logger';

export type ObjectId = mongoose.Types.ObjectId;

// Connection-lifecycle events were log-only. A counter keyed by the (bounded)
// event name makes flapping/reconnect storms visible on a dashboard and
// alertable (see agent_docs/observability.md).
const mongoConnectionEventsCounter = getCounter(
  'hyperdx.mongodb.connection_events',
  {
    description:
      'Count of MongoDB connection lifecycle events, labeled by event (connected, disconnected, error, reconnected, reconnect_failed).',
  },
);

// set flags
mongoose.set('strictQuery', false);

// Allow empty strings to be set to required fields
// https://github.com/Automattic/mongoose/issues/7150
// ex. query in logview can be empty
mongoose.Schema.Types.String.checkRequired(v => v != null);

// connection events handlers
mongoose.connection.on('connected', () => {
  mongoConnectionEventsCounter.add(1, { event: 'connected' });
  logger.info('Connection established to MongoDB');
});

mongoose.connection.on('disconnected', () => {
  mongoConnectionEventsCounter.add(1, { event: 'disconnected' });
  logger.info('Lost connection to MongoDB server');
});

mongoose.connection.on('error', err => {
  mongoConnectionEventsCounter.add(1, { event: 'error' });
  logger.error({ err }, 'Could not connect to MongoDB');
});

mongoose.connection.on('reconnected', () => {
  mongoConnectionEventsCounter.add(1, { event: 'reconnected' });
  logger.warn('Reconnected to MongoDB');
});

mongoose.connection.on('reconnectFailed', () => {
  mongoConnectionEventsCounter.add(1, { event: 'reconnect_failed' });
  logger.error('Failed to reconnect to MongoDB');
});

export const connectDB = async () => {
  // breadcrumbs for future greppers: aws4 is included as a dependency of the api so that
  // users can use AWS auth in their mongo connection string here, e.g.
  // mongodb+srv://blahblah...mongodb.net/hyperdx?authSource=%24external&authMechanism=MONGODB-AWS
  if (config.MONGO_URI == null) {
    throw new Error('MONGO_URI is not set');
  }
  await mongoose.connect(config.MONGO_URI, {
    heartbeatFrequencyMS: 10000, // retry failed heartbeats
    maxPoolSize: 100, // 5 nodes -> max 1000 connections
  });
};

export const mongooseConnection = mongoose.connection;
