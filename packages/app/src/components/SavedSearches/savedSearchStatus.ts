import { isEqual } from 'lodash';
import { Filter } from '@hyperdx/common-utils/dist/types';

export type SavedSearchStatus = 'unsaved' | 'saved' | 'edited';

type SearchFields = {
  select?: string | null;
  where?: string | null;
  whereLanguage?: string | null;
  source?: string | null;
  orderBy?: string | null;
  filters?: Filter[] | null;
};

function normalize(fields: SearchFields) {
  return {
    select: fields.select || '',
    where: fields.where || '',
    whereLanguage: fields.whereLanguage || 'lucene',
    source: fields.source || '',
    orderBy: fields.orderBy || '',
    filters: fields.filters ?? [],
  };
}

function isEmpty(fields: SearchFields) {
  return (
    !fields.source &&
    !fields.where &&
    !fields.select &&
    !fields.whereLanguage &&
    !fields.orderBy &&
    !fields.filters?.length
  );
}

/** Whether the search that was run still matches the saved search it came from. */
export function getSavedSearchStatus(
  savedSearch: SearchFields | undefined,
  searchedConfig: SearchFields,
): SavedSearchStatus {
  if (savedSearch == null) return 'unsaved';
  // The URL is briefly empty when landing on a saved search, until the page
  // copies the saved search into it.
  if (isEmpty(searchedConfig)) return 'saved';
  return isEqual(normalize(savedSearch), normalize(searchedConfig))
    ? 'saved'
    : 'edited';
}
