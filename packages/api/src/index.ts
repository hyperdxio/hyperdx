import { serializeError } from 'serialize-error';

import * as config from './config';
import Server from './server';
import logger from './utils/logger';
import { initCiEnvs } from './fixtures';
import { isOperationalError } from './utils/errors';

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

// graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received.');

  if (config.IS_DEV) {
    logger.info('Http server is forced to stop immediately.');
    process.exit(0);
  }

  server.stop();
});

server
  .start()
  .then(() => {
    // TODO: a quick hack to work with e2e. We should do this in separate op
    if (config.IS_CI) {
      // place where we setup fake data for CI
      return initCiEnvs();
    }
  })
  .catch(e => logger.error(serializeError(e)));
