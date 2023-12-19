import http from 'http';

import { serializeError } from 'serialize-error';

import * as clickhouse from './clickhouse';
import * as config from './config';
import logger from './utils/logger';
import redisClient from './utils/redis';
import { connectDB, mongooseConnection } from './models';

export default class Server {
  protected httpServer!: http.Server;

  private async createServer() {
    switch (config.APP_TYPE) {
      case 'api':
        return http.createServer(
          // eslint-disable-next-line node/no-unsupported-features/es-syntax
          (await import('./api-app').then(m => m.default)) as any,
        );
      case 'aggregator':
        return http.createServer(
          // eslint-disable-next-line node/no-unsupported-features/es-syntax
          (await import('./aggregator-app').then(m => m.default)) as any,
        );
      default:
        throw new Error(`Invalid APP_TYPE: ${config.APP_TYPE}`);
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

    await Promise.all([
      connectDB(),
      redisClient.connect(),
      clickhouse.connect(),
    ]);
  }

  // graceful shutdown
  stop() {
    this.httpServer.close(closeServerErr => {
      if (closeServerErr) {
        logger.error(serializeError(closeServerErr));
      }
      logger.info('Http server closed.');
      redisClient
        .disconnect()
        .then(() => {
          logger.info('Redis client disconnected.');
        })
        .catch((err: any) => {
          logger.error(serializeError(err));
        });
      mongooseConnection.close(false, closeDBConnectionErr => {
        if (closeDBConnectionErr) {
          logger.error(serializeError(closeDBConnectionErr));
        }
        logger.info('Mongo connection closed.');

        if (closeServerErr || closeDBConnectionErr) {
          process.exit(1);
        }
        process.exit(0);
      });
    });
  }
}
