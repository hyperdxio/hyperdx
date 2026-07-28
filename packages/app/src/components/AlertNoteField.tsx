import { Control, Controller, FieldValues, Path } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Text, Textarea } from '@mantine/core';

export function AlertNoteField<T extends FieldValues>({
  control,
  name,
  labelMarginTop = 'xs',
}: {
  control: Control<T>;
  name: Path<T>;
  labelMarginTop?: string;
}) {
  const { t } = useTranslation('alerts');

  return (
    <>
      <Text size="xxs" opacity={0.5} mb={4} mt={labelMarginTop}>
        {t('note.label')}
      </Text>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Textarea
            data-testid="alert-note-input"
            size="xs"
            minRows={2}
            maxRows={6}
            autosize
            placeholder={t('note.placeholder')}
            {...field}
            value={field.value ?? ''}
            onChange={e => field.onChange(e.target.value || null)}
          />
        )}
      />
    </>
  );
}
