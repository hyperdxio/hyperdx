import { Control } from 'react-hook-form';
import { TSource } from '@hyperdx/common-utils/dist/types';

import SelectControlled from '@/components/SelectControlled';

import { USE_TEXT_INDEX_OPTIONS } from './constants';
import { FormRow } from './FormRow';

export function UseTextIndexFormRow({
  control,
}: {
  control: Control<TSource>;
}) {
  return (
    <FormRow
      label="Use Text Index"
      helpText='Whether Lucene-based searches should emit hasAllTokens() when searching the implicit column. "Auto" (the default) detects a covering text index from skip-index metadata at query time; "Force enable" always emits hasAllTokens(), and is useful when querying a table using the merge table engine; "Force disable" falls back to hasToken().'
    >
      <SelectControlled
        control={control}
        name="useTextIndexForImplicitColumn"
        data={USE_TEXT_INDEX_OPTIONS}
        placeholder={USE_TEXT_INDEX_OPTIONS[0].label}
        allowDeselect={false}
      />
    </FormRow>
  );
}
