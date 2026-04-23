import { useMemo } from 'react';
import { Controller } from 'react-hook-form';
import { Select } from '@mantine/core';

import { TextInputControlled } from '@/components/InputControlled';
import { InputLabelWithTooltip } from '@/components/InputLabelWithTooltip';

import { DrawerControl } from './utils';

const TEMPLATE_SELECT_VALUE = 'template';

export function OnClickTargetInputControlled({
  control,
  options,
  objectType,
}: {
  control: DrawerControl;
  options: { label: string; value: string }[];
  objectType: 'source' | 'dashboard';
}) {
  const optionsWithTemplate = useMemo(() => {
    return [
      {
        group: 'Template',
        items: [
          {
            label: 'Template',
            value: TEMPLATE_SELECT_VALUE,
          },
        ],
      },
      {
        group: objectType === 'dashboard' ? 'Dashboard' : 'Source',
        items: options,
      },
    ];
  }, [options, objectType]);

  const label = objectType === 'dashboard' ? 'Dashboard' : 'Source';
  const labelTooltip =
    objectType === 'dashboard'
      ? 'A dashboard, or a Handlebars template that is matched by name to an available dashboard'
      : 'A source, or a Handlebars template that is matched by name to an available Log or Trace source';
  const placeholder =
    objectType === 'dashboard'
      ? 'e.g. Error Dashboard or Errors-{{ServiceName}}'
      : 'e.g. Logs or Logs-{{Environment}}';

  return (
    <Controller
      control={control}
      name="onClick.target"
      render={({ field, fieldState }) => {
        return (
          <>
            <InputLabelWithTooltip label={label} tooltip={labelTooltip} />
            <Select
              data={optionsWithTemplate}
              data-testid="onclick-target-select"
              value={
                field.value?.mode === 'template'
                  ? TEMPLATE_SELECT_VALUE
                  : field.value?.id
              }
              onChange={value => {
                if (value === TEMPLATE_SELECT_VALUE) {
                  field.onChange({ mode: 'template', template: '' });
                } else {
                  field.onChange({ mode: 'id', id: value ?? '' });
                }
              }}
            />
            {field.value?.mode === 'template' && (
              <TextInputControlled
                control={control}
                name="onClick.target.template"
                placeholder={placeholder}
                data-testid="onclick-template-input"
                error={fieldState.error?.message}
              />
            )}
          </>
        );
      }}
    />
  );
}
