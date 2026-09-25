import { AsyncLocalStorage } from 'node:async_hooks';

import type {
  BaseResultSet,
  ClickHouseClient as NodeClickHouseClient,
  ClickHouseSettings,
  DataFormat,
} from '@clickhouse/client';
import { createClient } from '@clickhouse/client';

import { mergeQueryAttribution, QueryAttribution } from './attribution';
import {
  BaseClickhouseClient,
  ClickhouseClientOptions,
  QueryInputs,
} from './index';

// for api fixtures
export { createClient as createNativeClient };

/**
 * On the server, the code that knows why a query is happening sits far above
 * the code that runs it, and one client is shared by concurrent work. So the
 * entry point sets this once and every query below it picks it up.
 *
 * Node only. The browser uses React context for the same job.
 */
const attributionStore = new AsyncLocalStorage<QueryAttribution>();

/**
 * Tags every ClickHouse query `fn` issues. Wrap the whole request or job, not
 * each query.
 */
export function withQueryAttribution<T>(
  attribution: QueryAttribution,
  fn: () => T,
): T {
  const merged = mergeQueryAttribution(
    attributionStore.getStore(),
    attribution,
  );
  return attributionStore.run(merged, fn);
}

/** What is in effect right now, if anything. */
export function getCurrentQueryAttribution(): QueryAttribution | undefined {
  return attributionStore.getStore();
}

export class ClickhouseClient extends BaseClickhouseClient {
  constructor(options: ClickhouseClientOptions) {
    super(options);

    this.client = createClient({
      url: this.host,
      username: this.username,
      password: this.password,
      request_timeout: this.requestTimeout,
      application: this.application,
      use_multipart_params_auto: true,
    });
  }

  /**
   * Order of precedence: the client's own default, then this request's scope,
   * then anything passed with the query.
   */
  protected applyAttribution<Format extends DataFormat>(
    props: QueryInputs<Format>,
  ): QueryInputs<Format> {
    const ambient = attributionStore.getStore();
    if (!ambient) return super.applyAttribution(props);

    return super.applyAttribution({
      ...props,
      attribution: mergeQueryAttribution(ambient, props.attribution),
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
