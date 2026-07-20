import type {
  BaseResultSet,
  ClickHouseClient as NodeClickHouseClient,
  ClickHouseSettings,
  DataFormat,
} from '@clickhouse/client';
import { createClient } from '@clickhouse/client';

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

  // This subclass always builds a node client, so narrow the base class's
  // platform-agnostic client type to the node-specific one.
  protected getClient(): NodeClickHouseClient {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- subclass always builds a node client
    return super.getClient() as NodeClickHouseClient;
  }

  protected async __query<Format extends DataFormat>({
    query,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- default generic value
    format = 'JSON' as Format,
    query_params = {},
    abort_signal,
    clickhouse_settings: externalClickhouseSettings,
    connectionId,
    queryId,
    shouldSkipApplySettings,
  }: QueryInputs<Format>): Promise<BaseResultSet<ReadableStream, Format>> {
    this.logQuery(query, query_params);

    let clickhouseSettings: ClickHouseSettings | undefined;
    // If this is the settings query, we must not process the clickhouse settings, or else we will infinitely recurse
    if (!shouldSkipApplySettings) {
      const neutralSettings = await this.processClickhouseSettings({
        externalClickhouseSettings,
        connectionId,
      });
      // processClickhouseSettings produces @clickhouse/client-common's
      // ClickHouseSettings. It is structurally identical to the node client's
      // own (self-bundled, since 1.23) ClickHouseSettings, but the two packages'
      // copies are distinct nominal types, so bridge explicitly.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- client library type mismatch
      clickhouseSettings = neutralSettings as ClickHouseSettings;
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
