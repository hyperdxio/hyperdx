import { getMetadata as _getMetadata } from '@hyperdx/common-utils/dist/metadata';

import { getClickhouseClient } from '@/clickhouse';

const _metadata = _getMetadata(getClickhouseClient());

// TODO: Get rid of this function and directly consume singleton
export const getMetadata = () => _metadata;
