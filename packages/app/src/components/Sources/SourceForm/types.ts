import { Control, UseFormSetValue } from 'react-hook-form';
import { TSource } from '@hyperdx/common-utils/dist/types';

export interface TableModelProps {
  control: Control<TSource>;
  setValue: UseFormSetValue<TSource>;
  // Set when editing an existing source
  sourceId?: string;
}
