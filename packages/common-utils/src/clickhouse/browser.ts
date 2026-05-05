/**
 * Transitional ClickHouse browser-client shim (Berg / Task 4).
 *
 * The original `clickhouse/browser.ts` provided a concrete `ClickhouseClient`
 * built on top of `@clickhouse/client-web`.  Task 4 deletes the runtime
 * client; Tasks 9/11 will rewrite the call sites in `packages/app` against
 * the new `@/athena` `AthenaClient`.
 *
 * Until then, this file exposes a stub `ClickhouseClient` class with the
 * same constructor / method shape as the deleted one so the app still
 * compiles and unit tests keep mocking it the way they always did.
 * Calling `query()` on this stub throws — production runtime code paths
 * have already been removed by Task 2.
 */

import type { BaseResultSet, DataFormat } from '@clickhouse/client-common';

import {
  BaseClickhouseClient,
  ClickhouseClientOptions,
  QueryInputs,
} from './index';

export class ClickhouseClient extends BaseClickhouseClient {
  constructor(options: ClickhouseClientOptions = {}) {
    super(options);
  }

  protected async __query<Format extends DataFormat>(
    _inputs: QueryInputs<Format>,
  ): Promise<BaseResultSet<ReadableStream, Format>> {
    throw new Error(
      'ClickhouseClient.__query has been disabled in Berg.  ' +
        'Use the Athena client at @berg/common-utils/dist/athena instead.',
    );
  }
}

export const testLocalConnection = async (_args: {
  host: string;
  username: string;
  password: string;
}): Promise<boolean> => {
  return false;
};
