import { createClient } from '@clickhouse/client';
import type {
  BaseResultSet,
  ClickHouseSettings,
  DataFormat,
} from '@clickhouse/client-common';

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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- default generic value
    format = 'JSON' as Format,
    query_params = {},
    abort_signal,
    clickhouse_settings: externalClickhouseSettings,
    queryId,
    shouldSkipApplySettings,
  }: QueryInputs<Format>): Promise<BaseResultSet<ReadableStream, Format>> {
    this.logDebugQuery(query, query_params);

    let clickhouseSettings: ClickHouseSettings | undefined;
    // If this is the settings query, we must not process the clickhouse settings, or else we will infinitely recurse
    if (!shouldSkipApplySettings) {
      clickhouseSettings = await this.processClickhouseSettings({
        externalClickhouseSettings,
      });
    }

    // TODO: Custom error handling
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- client library type mismatch
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
