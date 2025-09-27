import type {
  BaseResultSet,
  ClickHouseSettings,
  DataFormat,
} from '@clickhouse/client-common';
import { createClient } from '@clickhouse/client-web';

import {
  BaseClickhouseClient,
  ClickhouseClientOptions,
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

  private buildClient() {
    let url = this.host!;
    let myFetch: typeof fetch;
    const isLocalMode = this.username != null && this.password != null;
    const clickhouseSettings: ClickHouseSettings = {};

    if (isLocalMode) {
      myFetch = localModeFetch;
      clickhouseSettings.add_http_cors_header = 1;
    } else {
      url = `${window.origin}${this.host}`; // this.host is just a pathname in this scenario
      myFetch = standardModeFetch;
    }

    const parsedUrl = new URL(url);
    return createClient({
      url: parsedUrl.origin,
      pathname: parsedUrl.pathname,
      clickhouse_settings: clickhouseSettings,
      username: this.username ?? '',
      password: this.password ?? '',
      // Disable keep-alive to prevent multiple concurrent dashboard requests from exceeding the 64KB payload size limit.
      keep_alive: {
        enabled: false,
      },
      fetch: myFetch,
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
    connectionId,
    queryId,
  }: QueryInputs<Format>): Promise<BaseResultSet<ReadableStream, Format>> {
    // FIXME: we couldn't initialize the client in the constructor
    // since the window is not avalible
    if (this.client == null) {
      this.client = this.buildClient();
    }

    this.logDebugQuery(query, query_params);

    const clickhouseSettings = this.processClickhouseSettings(
      externalClickhouseSettings,
    );

    const httpHeaders: { [header: string]: string } = {
      ...(connectionId && connectionId !== 'local'
        ? { 'x-hyperdx-connection-id': connectionId }
        : {}),
    };

    return this.getClient().query({
      query,
      query_params,
      format,
      abort_signal,
      http_headers: httpHeaders,
      clickhouse_settings: clickhouseSettings,
      query_id: queryId,
    }) as Promise<BaseResultSet<ReadableStream, Format>>;
  }
}
