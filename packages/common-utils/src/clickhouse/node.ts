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

    this.client = createClient({
      url: this.host,
      username: this.username,
      password: this.password,
      request_timeout: this.requestTimeout,
      application: this.application,
    });
  }

  protected async __query<Format extends DataFormat>({
    query,
    format = 'JSON' as Format,
    query_params = {},
    abort_signal,
    clickhouse_settings: externalClickhouseSettings,
    queryId,
  }: QueryInputs<Format>): Promise<BaseResultSet<ReadableStream, Format>> {
    this.logDebugQuery(query, query_params);

    const clickhouseSettings = this.processClickhouseSettings(
      externalClickhouseSettings,
    );

    // TODO: Custom error handling
    return this.getClient().query({
      query,
      query_params,
      format,
      abort_signal,
      clickhouse_settings: clickhouseSettings,
      query_id: queryId,
    }) as unknown as Promise<BaseResultSet<ReadableStream, Format>>;
  }
}
