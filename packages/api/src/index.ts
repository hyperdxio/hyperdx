import { getHyperDXMetricReader } from '@hyperdx/node-opentelemetry/build/src/metrics';
import { HostMetrics } from '@opentelemetry/host-metrics';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { serializeError } from 'serialize-error';

import * as config from '@/config';
import Server from '@/server';
import { isOperationalError } from '@/utils/errors';
import logger from '@/utils/logger';

// Start collecting host metrics
const meterProvider = new MeterProvider({
  readers: [getHyperDXMetricReader()],
});
const hostMetrics = new HostMetrics({ meterProvider });
hostMetrics.start();

const server = new Server();

process.on('uncaughtException', (err: Error) => {
  logger.error(serializeError(err));

  // FIXME: disable server restart until
  // we make sure all expected exceptions are handled properly
  if (config.IS_DEV && !isOperationalError(err)) {
    process.exit(1);
  }
});

process.on('unhandledRejection', (err: any) => {
  // TODO: do we want to throw here ?
  logger.error(serializeError(err));
});

server.start().catch(e => logger.error(serializeError(e)));
