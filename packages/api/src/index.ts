import { flush } from '@clickhouse/clickstack-node';
import { serializeError } from 'serialize-error';

import * as config from '@/config';
import Server from '@/server';
import { isOperationalError } from '@/utils/errors';
import logger from '@/utils/logger';

const server = new Server();

// process.exit() skips the SDK's exit-time flush, so export what is buffered
// first. Before init (no key set) flush() resolves at once.
const exitAfterFlush = (code: number) => {
  void flush().finally(() => process.exit(code));
};

process.on('uncaughtException', (err: Error) => {
  logger.error({ err: serializeError(err) }, 'Uncaught exception');

  // FIXME: disable server restart until
  // we make sure all expected exceptions are handled properly
  if (config.IS_DEV && !isOperationalError(err)) {
    exitAfterFlush(1);
  }
});

process.on('unhandledRejection', (err: any) => {
  // TODO: do we want to throw here ?
  logger.error({ err: serializeError(err) }, 'Unhandled rejection');
});

server.start().catch(e => {
  // start() only rejects on non-retryable failures (e.g. MONGO_URI unset) —
  // transient MongoDB connection errors are retried internally. Exit so the
  // orchestrator restarts us instead of lingering as a zombie that listens
  // but can never serve (https://github.com/ClickHouse/ClickStack/issues/2966).
  logger.error({ err: serializeError(e) }, 'Server start failed, exiting');
  exitAfterFlush(1);
});
