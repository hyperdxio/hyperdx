import { getMetadata as _getMetadata } from '@hyperdx/common-utils/dist/metadata';

import { getClickhouseClient } from '@/clickhouse';

// TODO: Get rid of this function and convert to singleton
export const getMetadata = () => _getMetadata(getClickhouseClient());
