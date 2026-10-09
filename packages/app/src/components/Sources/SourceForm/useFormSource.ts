import { useMemo } from 'react';
import { Control, useWatch } from 'react-hook-form';
import { SourceLike, TSource } from '@hyperdx/common-utils/dist/types';

import { DEFAULT_DATABASE } from './constants';

/**
 * The source being edited, as far as field discovery needs it. The timestamp
 * expression is left out: it is often mid-edit here, and an invalid one would
 * fail discovery for every field in the form.
 */
export function useFormSource(control: Control<TSource>): SourceLike {
  const [kind, connection, databaseName, tableName] = useWatch({
    control,
    name: ['kind', 'connection', 'from.databaseName', 'from.tableName'],
  });
  return useMemo(
    () => ({
      kind,
      connection,
      from: { databaseName: databaseName ?? DEFAULT_DATABASE, tableName },
    }),
    [kind, connection, databaseName, tableName],
  );
}
