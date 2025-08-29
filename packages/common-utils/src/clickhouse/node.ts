import { createClient } from '@clickhouse/client';
import type {
  BaseResultSet,
  ClickHouseSettings,
  DataFormat,
} from '@clickhouse/client-common';

import {
  BaseClickhouseClient,
  ClickhouseClientOptions,
  parameterizedQueryToSql,
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
    let debugSql = '';
    try {
      debugSql = parameterizedQueryToSql({ sql: query, params: query_params });
    } catch (e) {
      debugSql = query;
    }

    // eslint-disable-next-line no-console
    console.log('--------------------------------------------------------');
    // eslint-disable-next-line no-console
    console.log('Sending Query:', debugSql);
    // eslint-disable-next-line no-console
    console.log('--------------------------------------------------------');

    const clickhouse_settings = structuredClone(
      external_clickhouse_settings || {},
    );
    if (clickhouse_settings?.max_rows_to_read && this.maxRowReadOnly) {
      delete clickhouse_settings['max_rows_to_read'];
    }

    const _client = createClient({
      url: this.host,
      username: this.username,
      password: this.password,
    });

    // TODO: Custom error handling
    return _client.query({
      query,
      query_params,
      format,
      abort_signal,
      clickhouse_settings: {
        date_time_output_format: 'iso',
        wait_end_of_query: 0,
        cancel_http_readonly_queries_on_client_close: 1,
        ...clickhouse_settings,
      },
      query_id: queryId,
    }) as unknown as Promise<BaseResultSet<ReadableStream, Format>>;
  }
}
