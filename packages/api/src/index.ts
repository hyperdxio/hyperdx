import { flush } from '@clickhouse/clickstack-node';
import { HostMetrics } from '@opentelemetry/host-metrics';
import { serializeError } from 'serialize-error';

import * as config from '@/config';
import Server from '@/server';
import { isOperationalError } from '@/utils/errors';
import logger from '@/utils/logger';

if (config.IS_DEV) {
  // No meterProvider: use the global one the SDK preload registered, so host
  // metrics carry the API's resource (service.name) and exporter settings.
  new HostMetrics({ name: 'hyperdx-api-host-metrics' }).start();
}

const server = new Server();

process.on('uncaughtException', (err: Error) => {
  logger.error({ err: serializeError(err) }, 'Uncaught exception');

  // FIXME: disable server restart until
  // we make sure all expected exceptions are handled properly
  if (config.IS_DEV && !isOperationalError(err)) {
    // This listener takes over the SDK's crash exit, so export the crash
    // record before exiting. flush() is bounded and never rejects.
    void flush().finally(() => process.exit(1));
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
  // but can never serve (https://github.com/hyperdxio/hyperdx/issues/2966).
  logger.error({ err: serializeError(e) }, 'Server start failed, exiting');
  process.exit(1);
});
