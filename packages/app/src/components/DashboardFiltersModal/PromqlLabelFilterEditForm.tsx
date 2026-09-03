import { useFormState } from 'react-hook-form';
import {
  DashboardFilter,
  isPromqlSource,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { TextInput } from '@mantine/core';

import { SourceSelectControlled } from '@/components/SourceSelect';
import { useSources } from '@/source';

import { CustomInputWrapper } from './CustomInputWrapper';
import { FilterFormControl } from './filterFormState';
import { VariableNameInput } from './VariableNameInput';

interface PromqlLabelFilterEditFormProps {
  control: FilterFormControl;
  /** Filters other than the one being edited, used to keep variable names unique. */
  otherFilters: DashboardFilter[];
}

/** Form describing a Prometheus label dashboard filter */
export const PromqlLabelFilterEditForm = ({
  control,
  otherFilters,
}: PromqlLabelFilterEditFormProps) => {
  const { errors } = useFormState({ control });
  const { data: sources } = useSources();

  const validatePromqlSource = (value: string) => {
    const source = sources?.find(s => s.id === value);
    if (source && !isPromqlSource(source)) {
      return 'Select a PromQL source';
    }
    return true;
  };

  return (
    <>
      <CustomInputWrapper
        label="Data source"
        tooltipText="The PromQL source that the label values are read from"
      >
        <SourceSelectControlled
          control={control}
          name="source"
          data-testid="source-selector"
          rules={{
            required: 'Select a PromQL source',
            validate: validatePromqlSource,
          }}
          comboboxProps={{ withinPortal: true }}
          allowedSourceKinds={[SourceKind.Promql]}
        />
      </CustomInputWrapper>

      <CustomInputWrapper
        label="Label"
        tooltipText="The Prometheus label whose values fill the dropdown. Use __name__ to list metric names."
        error={errors.label}
      >
        <TextInput
          placeholder="e.g. instance, job, or __name__"
          data-testid="filter-label-input"
          {...control.register('label', {
            required: true,
            validate: value =>
              value.trim().length > 0 || 'This field is required',
          })}
        />
      </CustomInputWrapper>

      <VariableNameInput control={control} otherFilters={otherFilters} />
    </>
  );
};
