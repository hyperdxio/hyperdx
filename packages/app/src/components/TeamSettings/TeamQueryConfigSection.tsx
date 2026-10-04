import { useCallback, useState } from 'react';
import { SubmitHandler, useForm } from 'react-hook-form';
import { DEFAULT_METADATA_MAX_ROWS_TO_READ } from '@hyperdx/common-utils/dist/core/metadata';
import { type TeamClickHouseSettings } from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  InputLabel,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconHelpCircle, IconPencil } from '@tabler/icons-react';

import api from '@/api';
import SelectControlled from '@/components/SelectControlled';
import {
  DEFAULT_FILTER_KEYS_FETCH_LIMIT,
  DEFAULT_QUERY_TIMEOUT,
  DEFAULT_SEARCH_ROW_LIMIT,
} from '@/defaults';
import { useBrandDisplayName } from '@/theme/ThemeProvider';

function QueryLanguageSettingsForm() {
  const { data: me, refetch: refetchMe } = api.useMe();
  const updateQueryLanguageSettings = api.useUpdateQueryLanguageSettings();
  const hasAdminAccess = true;
  const [isEditing, setIsEditing] = useState(false);

  const allowedLanguages: ('sql' | 'lucene')[] = me?.team
    ?.allowedQueryLanguages ?? ['lucene', 'sql'];
  const defaultLanguage: 'sql' | 'lucene' =
    me?.team?.defaultQueryLanguage ?? 'lucene';

  const [selectedAllowed, setSelectedAllowed] =
    useState<('sql' | 'lucene')[]>(allowedLanguages);
  const [selectedDefault, setSelectedDefault] = useState<'sql' | 'lucene'>(
    defaultLanguage,
  );

  const handleStartEdit = () => {
    setSelectedAllowed(allowedLanguages);
    setSelectedDefault(defaultLanguage);
    setIsEditing(true);
  };

  const handleToggleLanguage = (lang: 'sql' | 'lucene', checked: boolean) => {
    let newAllowed: ('sql' | 'lucene')[];
    if (checked) {
      newAllowed = [...selectedAllowed, lang];
    } else {
      newAllowed = selectedAllowed.filter(l => l !== lang);
    }
    if (newAllowed.length === 0) {
      notifications.show({
        color: 'red',
        message: 'At least one query language must be enabled',
      });
      return;
    }
    setSelectedAllowed(newAllowed);
    if (!newAllowed.includes(selectedDefault)) {
      setSelectedDefault(newAllowed[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedAllowed.length === 0) {
      notifications.show({
        color: 'red',
        message: 'At least one query language must be enabled',
      });
      return;
    }
    updateQueryLanguageSettings.mutate(
      {
        allowedQueryLanguages: selectedAllowed,
        defaultQueryLanguage: selectedDefault,
      },
      {
        onError: err => {
          notifications.show({
            color: 'red',
            message:
              err instanceof Error
                ? err.message
                : 'Failed to update query language settings',
          });
        },
        onSuccess: () => {
          notifications.show({
            color: 'green',
            message: 'Updated query language settings',
          });
          refetchMe();
          setIsEditing(false);
        },
      },
    );
  };

  return (
    <Stack gap="xs">
      <Group gap="xs">
        <InputLabel size="md">Query language configuration</InputLabel>
        <Tooltip label="Configure enabled query languages and default language for language pickers">
          <Text size="sm" style={{ cursor: 'help' }}>
            <IconHelpCircle size={14} />
          </Text>
        </Tooltip>
      </Group>
      <Text size="xs" c="dimmed">
        Restrict available query languages across search interfaces and set the
        default option.
      </Text>
      {isEditing && hasAdminAccess ? (
        <form onSubmit={handleSubmit}>
          <Stack gap="sm" mt="xs">
            <Box>
              <InputLabel size="xs" mb={4}>
                Enabled query languages
              </InputLabel>
              <Group gap="md">
                <Checkbox
                  label="Lucene"
                  checked={selectedAllowed.includes('lucene')}
                  onChange={e =>
                    handleToggleLanguage('lucene', e.currentTarget.checked)
                  }
                />
                <Checkbox
                  label="SQL"
                  checked={selectedAllowed.includes('sql')}
                  onChange={e =>
                    handleToggleLanguage('sql', e.currentTarget.checked)
                  }
                />
              </Group>
            </Box>
            <Box style={{ maxWidth: 300 }}>
              <InputLabel size="xs" mb={4}>
                Default query language
              </InputLabel>
              <Select
                size="xs"
                value={selectedDefault}
                onChange={val => {
                  if (val === 'sql' || val === 'lucene') {
                    setSelectedDefault(val);
                  }
                }}
                data={selectedAllowed.map(l => ({
                  value: l,
                  label: l === 'sql' ? 'SQL' : 'Lucene',
                }))}
              />
            </Box>
            <Group gap="xs" mt="xs">
              <Button
                type="submit"
                size="xs"
                variant="primary"
                loading={updateQueryLanguageSettings.isPending}
              >
                Save
              </Button>
              <Button
                type="button"
                size="xs"
                variant="secondary"
                disabled={updateQueryLanguageSettings.isPending}
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </Button>
            </Group>
          </Stack>
        </form>
      ) : (
        <Group align="flex-start" justify="space-between">
          <Stack gap={2}>
            <Text size="sm">
              <Text span fw={500}>
                Enabled:{' '}
              </Text>
              {allowedLanguages
                .map(l => (l === 'sql' ? 'SQL' : 'Lucene'))
                .join(', ')}
            </Text>
            <Text size="sm">
              <Text span fw={500}>
                Default:{' '}
              </Text>
              {defaultLanguage === 'sql' ? 'SQL' : 'Lucene'}
            </Text>
          </Stack>
          {hasAdminAccess && (
            <Button
              size="xs"
              variant="secondary"
              leftSection={<IconPencil size={16} />}
              onClick={handleStartEdit}
            >
              Change
            </Button>
          )}
        </Group>
      )}
    </Stack>
  );
}

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
  description?: string;
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
  description,
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

  const handleReset = useCallback(() => {
    if (defaultValue == null) return;
    updateClickhouseSettings.mutate(
      { [settingKey]: null },
      {
        onError: () => {
          notifications.show({
            color: 'red',
            message: `Failed to reset ${label}`,
          });
        },
        onSuccess: () => {
          notifications.show({
            color: 'green',
            message: `Reset ${label} to default`,
          });
          form.reset({ value: defaultValue });
          refetchMe();
          setIsEditing(false);
        },
      },
    );
  }, [
    refetchMe,
    updateClickhouseSettings,
    settingKey,
    label,
    defaultValue,
    form,
  ]);

  const isCustomValue = currentValue !== undefined;

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
      {description && (
        <Text size="xs" c="dimmed">
          {description}
        </Text>
      )}
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
          {hasAdminAccess && isCustomValue && defaultValue != null && (
            <Button
              size="xs"
              variant="subtle"
              loading={updateClickhouseSettings.isPending}
              onClick={handleReset}
            >
              Reset to default
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
        ? `${defaultValue.toLocaleString()} ${unit}`
        : value === 0
          ? 'Unlimited'
          : `${value.toLocaleString()} ${unit}`;

  return (
    <Box id="team_query_config">
      <Text size="md">Query Language Settings</Text>
      <Divider my="md" />
      <Card mb="lg">
        <QueryLanguageSettingsForm />
      </Card>

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
            settingKey="filterKeysFetchLimit"
            label="Filter Keys Fetch Limit"
            tooltip="The number of filter keys to fetch when clicking 'More filters' on the search page"
            type="number"
            defaultValue={DEFAULT_FILTER_KEYS_FETCH_LIMIT}
            placeholder={`default = ${DEFAULT_FILTER_KEYS_FETCH_LIMIT}`}
            min={1}
            max={1000}
            displayValue={displayValueWithUnit('keys')}
            description={`Default is ${DEFAULT_FILTER_KEYS_FETCH_LIMIT}`}
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
