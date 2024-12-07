import http from 'http';
import gracefulShutdown from 'http-graceful-shutdown';
import { serializeError } from 'serialize-error';

import * as config from './config';
import { connectDB, mongooseConnection } from './models';
import logger from './utils/logger';
import redisClient from './utils/redis';

export default class Server {
  protected readonly appType = config.APP_TYPE;

  protected shouldHandleGracefulShutdown = true;

  protected httpServer!: http.Server;

  private async createServer() {
    switch (this.appType) {
      case 'api':
        return http.createServer(
          // eslint-disable-next-line n/no-unsupported-features/es-syntax
          (await import('./api-app').then(m => m.default)) as any,
        );
      case 'aggregator':
        return http.createServer(
          // eslint-disable-next-line n/no-unsupported-features/es-syntax
          (await import('./aggregator-app').then(m => m.default)) as any,
        );
      default:
        throw new Error(`Invalid APP_TYPE: ${config.APP_TYPE}`);
    }
  }

  protected async shutdown(signal?: string) {
    let hasError = false;
    logger.info('Closing all db clients...');
    const [redisCloseResult, mongoCloseResult] = await Promise.allSettled([
      redisClient.disconnect(),
      mongooseConnection.close(false),
    ]);

    if (redisCloseResult.status === 'rejected') {
      hasError = true;
      logger.error(serializeError(redisCloseResult.reason));
    } else {
      logger.info('Redis client closed.');
    }

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
    this.httpServer = await this.createServer();
    this.httpServer.keepAliveTimeout = 61000; // Ensure all inactive connections are terminated by the ALB, by setting this a few seconds higher than the ALB idle timeout
    this.httpServer.headersTimeout = 62000; // Ensure the headersTimeout is set higher than the keepAliveTimeout due to this nodejs regression bug: https://github.com/nodejs/node/issues/27363

    this.httpServer.listen(config.PORT, () => {
      logger.info(
        `Server listening on port ${config.PORT}, NODE_ENV=${process.env.NODE_ENV}`,
      );
    });

    if (this.shouldHandleGracefulShutdown) {
      gracefulShutdown(this.httpServer, {
        signals: 'SIGINT SIGTERM',
        timeout: 10000, // 10 secs
        development: config.IS_DEV,
        forceExit: true, // triggers process.exit() at the end of shutdown process
        preShutdown: async () => {
          // needed operation before httpConnections are shutted down
        },
        onShutdown: this.shutdown,
        finally: () => {
          logger.info('Server gracefulls shutted down...');
        }, // finally function (sync) - e.g. for logging
      });
    }

    await Promise.all([connectDB(), redisClient.connect()]);
  }
}
