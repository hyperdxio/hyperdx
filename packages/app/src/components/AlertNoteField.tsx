import { Control, Controller, FieldValues, Path } from 'react-hook-form';
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
  return (
    <>
      <Text size="xxs" opacity={0.5} mb={4} mt={labelMarginTop}>
        Note
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
            placeholder="Why does this alert exist? Threshold history, links to runbooks, etc. Supports markdown."
            {...field}
            value={field.value ?? ''}
            onChange={e => field.onChange(e.target.value || null)}
          />
        )}
      />
    </>
  );
}
