import { Control, UseFormSetValue } from 'react-hook-form';
import { TSource } from '@hyperdx/common-utils/dist/types';

export interface TableModelProps {
  control: Control<TSource>;
  setValue: UseFormSetValue<TSource>;
  // True when editing a saved metric source that already has at least one
  // metric table configured. Used to suppress schema-inference autofill so we
  // never silently fill in tables the user hasn't actually saved.
  hasExistingMetricTables?: boolean;
}
