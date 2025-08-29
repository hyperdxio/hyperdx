import { createClient } from '@clickhouse/client';
import type { BaseResultSet, DataFormat } from '@clickhouse/client-common';

import {
  BaseClickhouseClient,
  ClickhouseClientOptions,
  QueryInputs,
} from './index';

// for api fixtures
export { createClient as createNativeClient };

export class ClickhouseClient extends BaseClickhouseClient {
  constructor(options: ClickhouseClientOptions) {
    super(options);
  }

  protected async __query<Format extends DataFormat>({
    query,
    format = 'JSON' as Format,
    query_params = {},
    abort_signal,
    clickhouse_settings: external_clickhouse_settings,
    queryId,
  }: QueryInputs<Format>): Promise<BaseResultSet<ReadableStream, Format>> {
    this.logDebugQuery(query, query_params);

    const clickhouse_settings = this.processClickhouseSettings(
      external_clickhouse_settings,
    );

    const _client = createClient({
      url: this.host,
      username: this.username,
      password: this.password,
      request_timeout: this.requestTimeout,
    });

    // TODO: Custom error handling
    return _client.query({
      query,
      query_params,
      format,
      abort_signal,
      clickhouse_settings,
      query_id: queryId,
    }) as unknown as Promise<BaseResultSet<ReadableStream, Format>>;
  }
}
