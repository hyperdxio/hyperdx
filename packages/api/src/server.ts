import http from 'http';
import gracefulShutdown from 'http-graceful-shutdown';
import { serializeError } from 'serialize-error';

import app from '@/api-app';
import * as config from '@/config';
import { connectDB, mongooseConnection } from '@/models';
import opampApp from '@/opamp/app';
import logger from '@/utils/logger';

export default class Server {
  protected shouldHandleGracefulShutdown = true;

  protected appServer!: http.Server;
  protected opampServer!: http.Server;

  private createAppServer() {
    return http.createServer(app);
  }

  private createOpampServer() {
    return http.createServer(opampApp);
  }

  protected async shutdown(signal?: string) {
    let hasError = false;
    logger.info('Closing all db clients...');
    const [mongoCloseResult] = await Promise.allSettled([
      mongooseConnection.close(false),
    ]);

    if (mongoCloseResult.status === 'rejected') {
      hasError = true;
      logger.error(serializeError(mongoCloseResult.reason));
    } else {
      logger.info('MongoDB client closed.');
    }

    if (hasError) {
      throw new Error('Failed to close all clients.');
    }
  }

  async start() {
    this.appServer = this.createAppServer();
    this.appServer.keepAliveTimeout = 61000; // Ensure all inactive connections are terminated by the ALB, by setting this a few seconds higher than the ALB idle timeout
    this.appServer.headersTimeout = 62000; // Ensure the headersTimeout is set higher than the keepAliveTimeout due to this nodejs regression bug: https://github.com/nodejs/node/issues/27363

    this.opampServer = this.createOpampServer();
    this.opampServer.keepAliveTimeout = 61000;
    this.opampServer.headersTimeout = 62000;

    this.appServer.listen(config.PORT, () => {
      logger.info(
        `API Server listening on port ${config.PORT}, NODE_ENV=${process.env.NODE_ENV}`,
      );
    });

    this.opampServer.listen(config.OPAMP_PORT, () => {
      logger.info(
        `OpAMP Server listening on port ${config.OPAMP_PORT}, NODE_ENV=${process.env.NODE_ENV}`,
      );
    });

    if (this.shouldHandleGracefulShutdown) {
      [this.appServer, this.opampServer].forEach(server => {
        gracefulShutdown(server, {
          signals: 'SIGINT SIGTERM',
          timeout: 10000, // 10 secs
          development: config.IS_DEV,
          forceExit: true, // triggers process.exit() at the end of shutdown process
          preShutdown: async () => {
            // needed operation before httpConnections are shutted down
          },
          onShutdown: this.shutdown,
          finally: () => {
            logger.info('Server gracefully shut down...');
          }, // finally function (sync) - e.g. for logging
        });
      });
    }

    await connectDB();
  }
}
