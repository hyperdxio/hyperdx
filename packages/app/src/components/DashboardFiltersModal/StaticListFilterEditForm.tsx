import { Controller, useFormState } from 'react-hook-form';
import { DashboardFilter } from '@hyperdx/common-utils/dist/types';
import { TagsInput } from '@mantine/core';

import { CustomInputWrapper } from './CustomInputWrapper';
import { FilterFormControl } from './filterFormState';
import { VariableNameInput } from './VariableNameInput';

interface StaticListFilterEditFormProps {
  control: FilterFormControl;
  /** Filters other than the one being edited, used to keep variable names unique. */
  otherFilters: DashboardFilter[];
}

/** Form for editing a filter whose dropdown offers a hand-authored list. */
export const StaticListFilterEditForm = ({
  control,
  otherFilters,
}: StaticListFilterEditFormProps) => {
  const { errors } = useFormState({ control });
  const validateAtLeastOneOption = (value: string[]) =>
    (value?.length ?? 0) > 0 || 'Add at least one option';

  return (
    <>
      <CustomInputWrapper
        label="Options"
        tooltipText="The values available in the dropdown."
        error={errors.options}
      >
        <Controller
          control={control}
          name="options"
          rules={{
            validate: validateAtLeastOneOption,
          }}
          render={({ field: { onChange, value } }) => (
            <TagsInput
              value={value ?? []}
              onChange={onChange}
              placeholder="Type a value and press Enter"
              data-testid="filter-options-input"
              clearable
              splitChars={[',', '\n']}
            />
          )}
        />
      </CustomInputWrapper>

      <VariableNameInput control={control} otherFilters={otherFilters} />
    </>
  );
};
