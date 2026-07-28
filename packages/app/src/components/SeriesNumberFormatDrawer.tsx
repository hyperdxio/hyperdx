import { useCallback, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { NumberFormat } from '@hyperdx/common-utils/dist/types';
import {
  Button,
  Divider,
  Drawer,
  Group,
  SegmentedControl,
  Stack,
  Text,
} from '@mantine/core';

import { DEFAULT_NUMBER_FORMAT, NumberFormatForm } from './NumberFormat';

type FormState = { numberFormat?: NumberFormat };

interface SeriesNumberFormatDrawerProps {
  opened: boolean;
  numberFormat?: NumberFormat;
  onChange: (format: FormState) => void;
  onClose: () => void;
}

export default function SeriesNumberFormatDrawer({
  numberFormat: initialNumberFormat,
  opened,
  onChange,
  onClose,
}: SeriesNumberFormatDrawerProps) {
  const { t } = useTranslation('charts');
  const { control, handleSubmit, reset, setValue } = useForm<FormState>({
    defaultValues: undefined,
  });

  const numberFormat = useWatch({ control, name: 'numberFormat' });
  const isUsingCustomFormat = numberFormat != null;

  const resetToDefaults = useCallback(() => {
    reset({ numberFormat: initialNumberFormat });
  }, [reset, initialNumberFormat]);

  useEffect(() => {
    resetToDefaults();
  }, [resetToDefaults]);

  const handleClose = useCallback(() => {
    reset({ numberFormat: initialNumberFormat });
    onClose();
  }, [onClose, reset, initialNumberFormat]);

  const applyChanges = useCallback(() => {
    handleSubmit(onChange)();
    onClose();
  }, [onChange, handleSubmit, onClose]);

  return (
    <Drawer
      title={t('seriesFormat.title')}
      opened={opened}
      onClose={handleClose}
      position="right"
    >
      <Stack>
        <SegmentedControl
          size="xs"
          value={isUsingCustomFormat ? 'format' : 'inherit'}
          onChange={value => {
            if (value === 'inherit') {
              setValue('numberFormat', undefined);
            } else if (numberFormat) {
              setValue('numberFormat', numberFormat);
            } else {
              setValue('numberFormat', DEFAULT_NUMBER_FORMAT);
            }
          }}
          data={[
            { label: t('seriesFormat.inherit'), value: 'inherit' },
            { label: t('seriesFormat.custom'), value: 'format' },
          ]}
        />
        {isUsingCustomFormat ? (
          <>
            <NumberFormatForm control={control} setValue={setValue} />
            <Divider />
          </>
        ) : (
          <Text size="xs">{t('seriesFormat.inheritDescription')}</Text>
        )}
        <Group gap="xs" mt="xs" justify="space-between">
          {isUsingCustomFormat ? (
            <Button type="submit" variant="secondary" onClick={resetToDefaults}>
              {t('common.reset')}
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" variant="primary" onClick={applyChanges}>
            {t('common.apply')}
          </Button>
        </Group>
      </Stack>
    </Drawer>
  );
}
