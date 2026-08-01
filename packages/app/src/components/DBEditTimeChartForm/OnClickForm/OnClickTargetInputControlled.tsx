import { useMemo } from 'react';
import { Controller } from 'react-hook-form';
import { OnClickTarget } from '@hyperdx/common-utils/dist/types';
import { Select } from '@mantine/core';

import { TextInputControlled } from '@/components/InputControlled';
import { InputLabelWithTooltip } from '@/components/InputLabelWithTooltip';

import { DrawerControl } from './utils';

const TEMPLATE_SELECT_VALUE = 'template';

export function OnClickTargetInputControlled({
  control,
  options,
  objectType,
  onTargetChange,
}: {
  control: DrawerControl;
  options: { label: string; value: string }[] | undefined;
  objectType: 'source' | 'dashboard';
  onTargetChange?: (target: OnClickTarget) => void;
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
        items: options ?? [],
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
        const selectedId =
          field.value?.mode === 'id' ? field.value.id : undefined;
        const targetMissing =
          options != null &&
          selectedId != null &&
          selectedId !== '' &&
          !options.some(option => option.value === selectedId);

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
              error={
                targetMissing
                  ? `The previously selected ${objectType} no longer exists. Choose another ${objectType}.`
                  : undefined
              }
              onChange={value => {
                const newTarget: OnClickTarget =
                  value === TEMPLATE_SELECT_VALUE
                    ? { mode: 'template', template: '' }
                    : { mode: 'id', id: value ?? '' };
                field.onChange(newTarget);
                onTargetChange?.(newTarget);
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
