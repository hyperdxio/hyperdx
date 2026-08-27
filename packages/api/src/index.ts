import { getHyperDXMetricReader } from '@hyperdx/node-opentelemetry/build/src/metrics';
import { HostMetrics } from '@opentelemetry/host-metrics';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { serializeError } from 'serialize-error';

import * as config from '@/config';
import Server from '@/server';
import { isOperationalError } from '@/utils/errors';
import logger from '@/utils/logger';

if (config.IS_DEV) {
  // Start collecting host metrics
  const meterProvider = new MeterProvider({
    // FIXME: missing selectCardinalityLimit property
    readers: [getHyperDXMetricReader() as unknown as MetricReader],
  });
  const hostMetrics = new HostMetrics({ meterProvider });
  hostMetrics.start();
}

const server = new Server();

process.on('uncaughtException', (err: Error) => {
  logger.error({ err: serializeError(err) }, 'Uncaught exception');

  // FIXME: disable server restart until
  // we make sure all expected exceptions are handled properly
  if (config.IS_DEV && !isOperationalError(err)) {
    process.exit(1);
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
