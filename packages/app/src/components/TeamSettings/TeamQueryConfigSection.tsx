import { useCallback, useState } from 'react';
import { SubmitHandler, useForm } from 'react-hook-form';
import { DEFAULT_METADATA_MAX_ROWS_TO_READ } from '@hyperdx/common-utils/dist/core/metadata';
import { type TeamClickHouseSettings } from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Button,
  Card,
  Divider,
  Group,
  InputLabel,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconHelpCircle, IconPencil } from '@tabler/icons-react';

import api from '@/api';
import SelectControlled from '@/components/SelectControlled';
import { DEFAULT_QUERY_TIMEOUT, DEFAULT_SEARCH_ROW_LIMIT } from '@/defaults';
import { useBrandDisplayName } from '@/theme/ThemeProvider';

type ClickhouseSettingType = 'number' | 'boolean';

interface ClickhouseSettingFormProps {
  settingKey: keyof TeamClickHouseSettings;
  label: string;
  tooltip?: string;
  type: ClickhouseSettingType;
  defaultValue?: number | string;
  placeholder?: string;
  min?: number;
  max?: number;
  displayValue?: (value: any, defaultValue?: any) => string;
}

function getFieldErrorMessage(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error != null &&
    'message' in error &&
    typeof error.message === 'string'
    ? error.message
    : undefined;
}

function ClickhouseSettingForm({
  settingKey,
  label,
  tooltip,
  type,
  defaultValue,
  placeholder,
  min,
  max,
  displayValue,
}: ClickhouseSettingFormProps) {
  const { data: me, refetch: refetchMe } = api.useMe();
  const updateClickhouseSettings = api.useUpdateClickhouseSettings();
  const hasAdminAccess = true;
  const [isEditing, setIsEditing] = useState(false);
  const currentValue = me?.team[settingKey];

  const form = useForm<{ value: any }>({
    defaultValues: {
      value:
        type === 'boolean' && displayValue != null && currentValue != null
          ? displayValue(currentValue)
          : (currentValue ?? defaultValue ?? ''),
    },
  });

  const onSubmit: SubmitHandler<{ value: any }> = useCallback(
    async values => {
      try {
        const settingValue =
          type === 'boolean'
            ? values.value === displayValue?.(true)
            : Number(values.value);

        updateClickhouseSettings.mutate(
          { [settingKey]: settingValue },
          {
            onError: _e => {
              notifications.show({
                color: 'red',
                message: `Failed to update ${label}`,
              });
            },
            onSuccess: () => {
              notifications.show({
                color: 'green',
                message: `Updated ${label}`,
              });
              refetchMe();
              setIsEditing(false);
            },
          },
        );
      } catch (e) {
        notifications.show({
          color: 'red',
          message: e instanceof Error ? e.message : `Failed to update ${label}`,
        });
      }
    },
    [
      refetchMe,
      updateClickhouseSettings,
      settingKey,
      label,
      type,
      displayValue,
    ],
  );

  return (
    <Stack gap="xs" mb="md">
      <Group gap="xs">
        <InputLabel size="md">{label}</InputLabel>
        {tooltip && (
          <Tooltip label={tooltip}>
            <Text size="sm" style={{ cursor: 'help' }}>
              <IconHelpCircle size={14} />
            </Text>
          </Tooltip>
        )}
      </Group>
      {isEditing && hasAdminAccess ? (
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <Group>
            {type === 'boolean' && displayValue ? (
              <SelectControlled
                control={form.control}
                name="value"
                data={[displayValue(true), displayValue(false)]}
                size="xs"
                placeholder="Please select"
                withAsterisk
                miw={300}
                readOnly={!isEditing}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setIsEditing(false);
                  }
                }}
              />
            ) : (
              <TextInput
                size="xs"
                type="number"
                placeholder={
                  placeholder || currentValue?.toString() || `Enter value`
                }
                required
                readOnly={!isEditing}
                error={getFieldErrorMessage(form.formState.errors.value)}
                {...form.register('value', {
                  required: true,
                })}
                miw={300}
                min={min}
                max={max}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setIsEditing(false);
                  }
                }}
              />
            )}
            <Button
              type="submit"
              size="xs"
              variant="primary"
              loading={updateClickhouseSettings.isPending}
            >
              Save
            </Button>
            <Button
              type="button"
              size="xs"
              variant="secondary"
              disabled={updateClickhouseSettings.isPending}
              onClick={() => {
                setIsEditing(false);
              }}
            >
              Cancel
            </Button>
          </Group>
        </form>
      ) : (
        <Group>
          <Text className="text-white">
            {displayValue
              ? displayValue(currentValue, defaultValue)
              : currentValue?.toString() || 'Not set'}
          </Text>
          {hasAdminAccess && (
            <Button
              size="xs"
              variant="secondary"
              leftSection={<IconPencil size={16} />}
              onClick={() => setIsEditing(true)}
            >
              Change
            </Button>
          )}
        </Group>
      )}
    </Stack>
  );
}

export default function TeamQueryConfigSection() {
  const brandName = useBrandDisplayName();
  const displayValueWithUnit =
    (unit: string) => (value: any, defaultValue?: any) =>
      value === undefined || value === defaultValue
        ? `${defaultValue.toLocaleString()} ${unit} (System Default)`
        : value === 0
          ? 'Unlimited'
          : `${value.toLocaleString()} ${unit}`;

  return (
    <Box id="team_name">
      <Text size="md">ClickHouse Client Settings</Text>
      <Divider my="md" />
      <Card>
        <Stack>
          <ClickhouseSettingForm
            settingKey="searchRowLimit"
            label="Search Row Limit"
            tooltip="The number of rows per query for the Search page or search dashboard tiles"
            type="number"
            defaultValue={DEFAULT_SEARCH_ROW_LIMIT}
            placeholder={`default = ${DEFAULT_SEARCH_ROW_LIMIT}, 0 = unlimited`}
            min={1}
            max={100000}
            displayValue={displayValueWithUnit('rows')}
          />
          <ClickhouseSettingForm
            settingKey="queryTimeout"
            label="Query Timeout (seconds)"
            tooltip="Sets the max execution time of a query in seconds."
            type="number"
            defaultValue={DEFAULT_QUERY_TIMEOUT}
            placeholder={`default = ${DEFAULT_QUERY_TIMEOUT}, 0 = unlimited`}
            min={0}
            displayValue={displayValueWithUnit('seconds')}
          />
          <ClickhouseSettingForm
            settingKey="metadataMaxRowsToRead"
            label="Max Rows to Read (METADATA ONLY)"
            tooltip="The maximum number of rows that can be read from a table when running a query"
            type="number"
            defaultValue={DEFAULT_METADATA_MAX_ROWS_TO_READ}
            placeholder={`default = ${DEFAULT_METADATA_MAX_ROWS_TO_READ.toLocaleString()}, 0 = unlimited`}
            min={0}
            displayValue={displayValueWithUnit('rows')}
          />
          <ClickhouseSettingForm
            settingKey="fieldMetadataDisabled"
            label="Field Metadata Queries"
            tooltip="Enable to fetch field metadata from ClickHouse"
            type="boolean"
            displayValue={value => (value ? 'Disabled' : 'Enabled')}
          />
          <ClickhouseSettingForm
            settingKey="parallelizeWhenPossible"
            label="Parallelize Queries When Possible"
            tooltip={`${brandName} sends windowed queries to ClickHouse in series. This setting parallelizes those queries when it makes sense to. This may cause increased peak load on ClickHouse`}
            type="boolean"
            displayValue={value => (value ? 'Enabled' : 'Disabled')}
          />
        </Stack>
      </Card>
    </Box>
  );
}
