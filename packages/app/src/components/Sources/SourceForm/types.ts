import { Control, UseFormSetValue } from 'react-hook-form';
import { TSource } from '@hyperdx/common-utils/dist/types';

export interface TableModelProps {
  control: Control<TSource>;
  setValue: UseFormSetValue<TSource>;
  // `database:connection` key the saved metric source was persisted with, set
  // only when that source already has at least one metric table configured.
  // Used to suppress schema-inference autofill for exactly that pair so we
  // never silently fill in tables the user hasn't actually saved — while still
  // allowing inference once the user switches to a different database or
  // connection. Undefined when there's nothing to suppress.
  savedMetricTablesKey?: string;
}
