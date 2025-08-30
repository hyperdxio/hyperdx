import { getMetadata as _getMetadata } from '@hyperdx/common-utils/dist/metadata';

import { getClickhouseClient } from '@/clickhouse';

import { DEFAULT_QUERY_TIMEOUT } from './defaults';

// TODO: Get rid of this function and convert to singleton
export const getMetadata = () =>
  _getMetadata(getClickhouseClient({ queryTimeout: DEFAULT_QUERY_TIMEOUT }));
