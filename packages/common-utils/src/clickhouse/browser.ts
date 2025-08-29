import type {
  BaseResultSet,
  ClickHouseSettings,
  DataFormat,
} from '@clickhouse/client-common';
import { createClient } from '@clickhouse/client-web';

import {
  BaseClickhouseClient,
  ClickhouseClientOptions,
  parameterizedQueryToSql,
  QueryInputs,
} from './index';

const localModeFetch: typeof fetch = (input, init) => {
  if (!init) init = {};
  const url = new URL(
    input instanceof URL ? input : input instanceof Request ? input.url : input,
  );

  // CORS is unhappy with the authorization header, so we will supply as query params instead
  const auth: string = init.headers?.['Authorization'];
  const [username, password] = window
    .atob(auth.substring('Bearer'.length))
    .split(':');
  delete init.headers?.['Authorization'];
  delete init.headers?.['authorization'];
  if (username) url.searchParams.set('user', username);
  if (password) url.searchParams.set('password', password);

  return fetch(`${url.toString()}`, init);
};

const standardModeFetch: typeof fetch = (input, init) => {
  if (!init) init = {};
  // authorization is handled on the backend, don't send this header
  delete init.headers?.['Authorization'];
  delete init.headers?.['authorization'];
  return fetch(input, init);
};

export const testLocalConnection = async ({
  host,
  username,
  password,
}: {
  host: string;
  username: string;
  password: string;
}): Promise<boolean> => {
  try {
    const client = new ClickhouseClient({ host, username, password });
    const result = await client.query({
      query: 'SELECT 1',
      format: 'TabSeparatedRaw',
    });
    return result.text().then(text => text.trim() === '1');
  } catch (e) {
    console.warn('Failed to test local connection', e);
    return false;
  }
};

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
    connectionId,
    queryId,
  }: QueryInputs<Format>): Promise<BaseResultSet<ReadableStream, Format>> {
    let debugSql = '';
    try {
      debugSql = parameterizedQueryToSql({ sql: query, params: query_params });
    } catch (e) {
      debugSql = query;
    }
    let _url = this.host;

    // eslint-disable-next-line no-console
    console.log('--------------------------------------------------------');
    // eslint-disable-next-line no-console
    console.log('Sending Query:', debugSql);
    // eslint-disable-next-line no-console
    console.log('--------------------------------------------------------');

    let clickhouse_settings = structuredClone(
      external_clickhouse_settings || {},
    );
    if (clickhouse_settings?.max_rows_to_read && this.maxRowReadOnly) {
      delete clickhouse_settings['max_rows_to_read'];
    }

    clickhouse_settings = {
      date_time_output_format: 'iso',
      wait_end_of_query: 0,
      cancel_http_readonly_queries_on_client_close: 1,
      ...clickhouse_settings,
    };
    const http_headers: { [header: string]: string } = {
      ...(connectionId && connectionId !== 'local'
        ? { 'x-hyperdx-connection-id': connectionId }
        : {}),
    };
    let myFetch: typeof fetch;
    const isLocalMode = this.username != null && this.password != null;
    if (isLocalMode) {
      myFetch = localModeFetch;
      clickhouse_settings.add_http_cors_header = 1;
    } else {
      _url = `${window.origin}${this.host}`; // this.host is just a pathname in this scenario
      myFetch = standardModeFetch;
    }

    const url = new URL(_url);
    const clickhouseClient = createClient({
      url: url.origin,
      pathname: url.pathname,
      http_headers,
      clickhouse_settings,
      username: this.username ?? '',
      password: this.password ?? '',
      // Disable keep-alive to prevent multiple concurrent dashboard requests from exceeding the 64KB payload size limit.
      keep_alive: {
        enabled: false,
      },
      fetch: myFetch,
      request_timeout: this.requestTimeout,
    });
    return clickhouseClient.query({
      query,
      query_params,
      format,
      abort_signal,
      clickhouse_settings,
      query_id: queryId,
    }) as Promise<BaseResultSet<ReadableStream, Format>>;
  }
}
