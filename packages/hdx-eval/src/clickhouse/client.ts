import { type ClickHouseClient, createClient } from '@clickhouse/client';
import ms from 'ms';

export type EvalClickHouseConfig = {
  url: string;
  username?: string;
  password?: string;
};

export function createEvalClient(
  cfg: EvalClickHouseConfig,
  application = 'hdx-eval',
): ClickHouseClient {
  return createClient({
    url: cfg.url,
    username: cfg.username ?? 'default',
    password: cfg.password ?? '',
    application,
    request_timeout: ms('2m'),
    compression: { request: false, response: false },
    clickhouse_settings: {
      date_time_input_format: 'best_effort',
      date_time_output_format: 'iso',
      max_execution_time: ms('2m') / 1000,
    },
  });
}

export function defaultClickHouseUrl(): string {
  if (process.env.HDX_EVAL_CH_URL) return process.env.HDX_EVAL_CH_URL;
  if (process.env.HDX_DEV_CH_HTTP_PORT) {
    return `http://localhost:${process.env.HDX_DEV_CH_HTTP_PORT}`;
  }
  return 'http://localhost:8123';
}
