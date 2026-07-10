import { Control, UseFormSetValue } from 'react-hook-form';
import { TSource } from '@hyperdx/common-utils/dist/types';

export interface TableModelProps {
  control: Control<TSource>;
  setValue: UseFormSetValue<TSource>;
}
