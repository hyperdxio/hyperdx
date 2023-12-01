import {
    Logger as _CHLogger,
  } from '@clickhouse/client';
  import {
    LogParams as _CHLogParams,
    ErrorLogParams as _CHErrorLogParams,
  } from '@clickhouse/client/dist/logger';
  import logger from '@/utils/logger';

export class CHLogger implements _CHLogger {
    debug({ module, message, args }: _CHLogParams): void {
      logger.debug({
        type: '@clickhouse/client',
        module,
        message,
        ...args,
      });
    }
  
    trace({ module, message, args }: _CHLogParams) {
      // TODO: trace level ??
      logger.info({
        type: '@clickhouse/client',
        module,
        message,
        ...args,
      });
    }
  
    info({ module, message, args }: _CHLogParams): void {
      logger.info({
        type: '@clickhouse/client',
        module,
        message,
        ...args,
      });
    }
  
    warn({ module, message, args }: _CHLogParams): void {
      logger.warn({
        type: '@clickhouse/client',
        module,
        message,
        ...args,
      });
    }
  
    error({ module, message, args, err }: _CHErrorLogParams): void {
      logger.error({
        type: '@clickhouse/client',
        module,
        message,
        ...args,
        err,
      });
    }
  }