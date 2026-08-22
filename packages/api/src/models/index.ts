import mongoose from 'mongoose';
import { serializeError } from 'serialize-error';

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
      'Count of MongoDB connection lifecycle events, labeled by event (connected, disconnected, error, reconnected, reconnect_failed, initial_connect_retry).',
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

export const connectDB = async (options?: mongoose.ConnectOptions) => {
  // breadcrumbs for future greppers: aws4 is included as a dependency of the api so that
  // users can use AWS auth in their mongo connection string here, e.g.
  // mongodb+srv://blahblah...mongodb.net/hyperdx?authSource=%24external&authMechanism=MONGODB-AWS
  if (config.MONGO_URI == null) {
    throw new Error('MONGO_URI is not set');
  }
  await mongoose.connect(config.MONGO_URI, {
    heartbeatFrequencyMS: 10000, // retry failed heartbeats
    maxPoolSize: 100, // 5 nodes -> max 1000 connections
    ...options,
  });
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export type ConnectRetryOptions = {
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Retry forever when undefined. Intended for tests. */
  maxAttempts?: number;
};

/**
 * Connect to MongoDB, retrying the *initial* connection with capped
 * exponential backoff until it succeeds.
 *
 * Mongoose only auto-reconnects after a successful initial connect — a failed
 * first `mongoose.connect()` is terminal. Long-lived servers must keep
 * retrying, otherwise a Mongo that comes up moments after the API leaves the
 * process permanently unable to serve while still listening (see
 * https://github.com/hyperdxio/hyperdx/issues/2966).
 *
 * Configuration errors (missing or malformed MONGO_URI) are not retryable
 * and are rethrown immediately so startup fails fast.
 */
export const connectDBWithRetry = async (
  options?: mongoose.ConnectOptions,
  retryOptions?: ConnectRetryOptions,
) => {
  const baseDelayMs = retryOptions?.baseDelayMs ?? 1000;
  const maxDelayMs = retryOptions?.maxDelayMs ?? 30000;
  const maxAttempts = retryOptions?.maxAttempts ?? Infinity;

  for (let attempt = 1; ; attempt++) {
    try {
      await connectDB(options);
      if (attempt > 1) {
        logger.info(
          { attempt },
          'Connection established to MongoDB after retrying',
        );
      }
      return;
    } catch (err) {
      // Missing config can never succeed on retry, and neither can a
      // malformed MONGO_URI: the driver's parse/argument errors are
      // deterministic, so rethrow and let the entrypoint exit instead of
      // retrying forever. Name-based check (not instanceof) so it survives
      // duplicated mongodb driver copies in node_modules. Auth and server
      // selection errors stay retryable — they are routinely transient while
      // MongoDB bootstraps (e.g. operators provision users after startup).
      const errName = err instanceof Error ? err.name : '';
      if (
        config.MONGO_URI == null ||
        errName === 'MongoParseError' ||
        errName === 'MongoInvalidArgumentError' ||
        attempt >= maxAttempts
      ) {
        throw err;
      }
      mongoConnectionEventsCounter.add(1, { event: 'initial_connect_retry' });
      const retryInMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      logger.error(
        { err: serializeError(err), attempt, retryInMs },
        'Initial MongoDB connection failed, retrying',
      );
      await sleep(retryInMs);
    }
  }
};

export const mongooseConnection = mongoose.connection;
