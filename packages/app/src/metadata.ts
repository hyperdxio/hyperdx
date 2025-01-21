import { getMetadata as _getMetadata } from '@hyperdx/common-utils/dist/metadata';

import { getClickhouseClient } from '@/clickhouse';

export const getMetadata = () => _getMetadata(getClickhouseClient());
