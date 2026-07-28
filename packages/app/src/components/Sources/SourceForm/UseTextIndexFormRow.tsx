import { Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { TSource } from '@hyperdx/common-utils/dist/types';

import SelectControlled from '@/components/SelectControlled';

import { useUseTextIndexOptions } from './constants';
import { FormRow } from './FormRow';

export function UseTextIndexFormRow({
  control,
}: {
  control: Control<TSource>;
}) {
  const { t } = useTranslation('sources');
  const useTextIndexOptions = useUseTextIndexOptions();

  return (
    <FormRow
      label={t('fields.useTextIndex')}
      helpText={t('fields.useTextIndexHelp')}
    >
      <SelectControlled
        control={control}
        name="useTextIndexForImplicitColumn"
        data={useTextIndexOptions}
        placeholder={useTextIndexOptions[0].label}
        allowDeselect={false}
      />
    </FormRow>
  );
}
