import { Control } from 'react-hook-form';
import { TSource } from '@hyperdx/common-utils/dist/types';

import SelectControlled from '@/components/SelectControlled';

import { MIN_AUTO_GRANULARITY_OPTIONS } from './constants';
import { FormRow } from './FormRow';

const MIN_AUTO_GRANULARITY_HELP_TEXT =
  "Floor for 'auto granularity' on charts querying this source. Set this to your metrics' scrape/report interval to avoid sparse-looking charts on short time ranges. Doesn't affect an explicitly chosen (non-auto) granularity.";

export function MinAutoGranularityFormRow({
  control,
  helpText = MIN_AUTO_GRANULARITY_HELP_TEXT,
}: {
  control: Control<TSource>;
  helpText?: string;
}) {
  return (
    <FormRow label="Minimum auto granularity" helpText={helpText}>
      <SelectControlled
        control={control}
        name="minAutoGranularity"
        data={MIN_AUTO_GRANULARITY_OPTIONS}
        allowDeselect={false}
        // An existing source's minAutoGranularity is undefined when
        // unset, which matches no entry in `data` (the "No minimum"
        // entry's value is '', not undefined) - SelectControlled then
        // renders blank rather than that option's label. The
        // placeholder covers exactly that unset state.
        placeholder="No minimum"
      />
    </FormRow>
  );
}
