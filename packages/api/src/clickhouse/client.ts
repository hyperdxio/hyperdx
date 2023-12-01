import {
    Logger as _CHLogger,
    createClient,
  } from '@clickhouse/client';
import { CHLogger } from './logger'
import * as config from '@/config';
import ms from 'ms';

export const client = createClient({
    host: config.CLICKHOUSE_HOST,
    username: config.CLICKHOUSE_USER,
    password: config.CLICKHOUSE_PASSWORD,
    request_timeout: ms('1m'),
    compression: {
      request: false,
      response: false, // has to be off to enable streaming
    },
    keep_alive: {
      enabled: true,
      // should be slightly less than the `keep_alive_timeout` setting in server's `config.xml`
      // default is 3s there, so 2500 milliseconds seems to be a safe client value in this scenario
      // another example: if your configuration has `keep_alive_timeout` set to 60s, you could put 59_000 here
      socket_ttl: 60000,
      retry_on_expired_socket: true,
    },
    clickhouse_settings: {
      connect_timeout: ms('1m') / 1000,
      date_time_output_format: 'iso',
      max_download_buffer_size: (10 * 1024 * 1024).toString(), // default
      max_download_threads: 32,
      max_execution_time: ms('2m') / 1000,
    },
    log: {
      LoggerClass: CHLogger,
    },
  });
  