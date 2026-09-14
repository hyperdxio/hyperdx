import {
  Control,
  Controller,
  FieldError,
  FieldValues,
  Merge,
  Path,
} from 'react-hook-form';
import { Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { IconTags } from '@tabler/icons-react';

import { Tags } from '@/components/Tags';

/**
 * A tags error usually sits on one element (`tags.3`), not on the array, so
 * fieldState.error is a sparse array of per-item errors with no message of
 * its own. Surface the first one found.
 */
function firstErrorMessage(
  error: Merge<FieldError, (FieldError | undefined)[]> | FieldError | undefined,
): string | undefined {
  if (error == null) return undefined;
  if (error.message) return error.message;
  if (Array.isArray(error)) {
    return error.find(e => e?.message)?.message;
  }
  return undefined;
}

export function AlertDisplayFields<T extends FieldValues>({
  control,
  displayNameName,
  tagsName,
  derivedDisplayName,
  displayNameRequired = false,
  tagsInherit = true,
  labelMarginTop = 'xs',
}: {
  control: Control<T>;
  displayNameName: Path<T>;
  tagsName: Path<T>;
  /** Name the server will derive when the field is left empty. */
  derivedDisplayName?: string | null;
  /**
   * Whether the alert must be named here. Set for alerts with no parent to
   * inherit a name from, where leaving it blank names the alert after
   * whatever the chart happens to be called.
   */
  displayNameRequired?: boolean;
  /**
   * Whether an unset tag list inherits from a parent. Set false for alerts
   * with no parent, where unset means no tags rather than "the ones over
   * there".
   */
  tagsInherit?: boolean;
  labelMarginTop?: string;
}) {
  return (
    <Group gap="xs" align="flex-start" wrap="nowrap" mt={labelMarginTop}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text size="xxs" opacity={0.5} mb={4}>
          Name
          {displayNameRequired && (
            <Text span c="red" ms={2} aria-hidden="true">
              *
            </Text>
          )}
        </Text>
        <Controller
          control={control}
          name={displayNameName}
          render={({ field, fieldState }) => (
            <TextInput
              data-testid="alert-display-name-input"
              size="xs"
              placeholder={
                displayNameRequired
                  ? 'Alert name'
                  : derivedDisplayName ||
                    'Defaults to the saved search or dashboard tile name'
              }
              error={fieldState.error?.message}
              {...field}
              value={field.value ?? ''}
              // Empty '' means "derive on the server", which is represented as null in the request
              onChange={e => field.onChange(e.target.value || null)}
            />
          )}
        />
      </div>

      <div>
        <Text size="xxs" opacity={0.5} mb={4}>
          Tags
        </Text>
        <Controller
          control={control}
          name={tagsName}
          render={({ field, fieldState }) => {
            const values: string[] = field.value ?? [];
            const error = firstErrorMessage(fieldState.error);
            return (
              <Stack gap={4}>
                <Tags allowCreate values={values} onChange={field.onChange}>
                  <Button
                    data-testid="alert-tags-button"
                    variant="secondary"
                    size="xs"
                    color={error ? 'red' : undefined}
                    style={{ flexShrink: 0 }}
                  >
                    <IconTags size={14} className="me-1" />
                    {/* Where there is a parent, an unset list inherits from it
                        and a count of 0 would misreport that. Where there is
                        not, unset really is none. */}
                    {field.value == null && tagsInherit
                      ? 'Inherited'
                      : values.length}
                  </Button>
                </Tags>
                {error && (
                  <Text size="xs" c="red" data-testid="alert-tags-error">
                    {error}
                  </Text>
                )}
              </Stack>
            );
          }}
        />
      </div>
    </Group>
  );
}
