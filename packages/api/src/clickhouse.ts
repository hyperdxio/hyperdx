import type {
  ClickhouseClientOptions,
  Logger as ClickhouseLogger,
} from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient as BaseClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';

import logger from '@/utils/logger';

const customLogger: ClickhouseLogger = {
  trace: ({ module, message, args }) =>
    logger.trace({ ...args, module }, message),
  debug: ({ module, message, args }) =>
    logger.debug({ ...args, module }, message),
  info: ({ module, message, args }) =>
    logger.info({ ...args, module }, message),
  warn: ({ module, message, args, err }) =>
    logger.warn({ ...args, module, err }, message),
  error: ({ module, message, args, err }) =>
    logger.error({ ...args, module, err }, message),
};

export class ClickhouseClient extends BaseClickhouseClient {
  constructor(options: ClickhouseClientOptions) {
    super({ ...options, customLogger: options.customLogger ?? customLogger });
  }
}
