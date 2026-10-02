import { getMetadata as _getMetadata } from '@hyperdx/common-utils/dist/core/metadata';

import { getClickhouseClient } from '@/clickhouse';

import { DEFAULT_QUERY_TIMEOUT } from './defaults';

// TODO: Get rid of this function and convert to singleton
//
// This instance is shared across pages, so it cannot know which page caused a
// lookup. Labelling it at least separates field lookups and autocomplete from
// a user's chart queries, and there are a lot of them.
export const getMetadata = () =>
  _getMetadata(
    getClickhouseClient({
      queryTimeout: DEFAULT_QUERY_TIMEOUT,
      attribution: { surface: 'metadata' },
    }),
  );
