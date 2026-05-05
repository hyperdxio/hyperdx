import { serializeError } from 'serialize-error';

import * as config from '@/config';
import Server from '@/server';
import { isOperationalError } from '@/utils/errors';
import logger from '@/utils/logger';

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

server
  .start()
  .catch(e => logger.error({ err: serializeError(e) }, 'Server start failed'));
