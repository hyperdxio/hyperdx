import { useCallback, useState } from 'react';
import { SubmitHandler, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
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
import {
  DEFAULT_FILTER_KEYS_FETCH_LIMIT,
  DEFAULT_QUERY_TIMEOUT,
  DEFAULT_SEARCH_ROW_LIMIT,
} from '@/defaults';
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
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
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
                message: t('queryConfig.updateFailed', { label }),
              });
            },
            onSuccess: () => {
              notifications.show({
                color: 'green',
                message: t('queryConfig.updated', { label }),
              });
              refetchMe();
              setIsEditing(false);
            },
          },
        );
      } catch (e) {
        notifications.show({
          color: 'red',
          message:
            e instanceof Error
              ? e.message
              : t('queryConfig.updateFailed', { label }),
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
      t,
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
            message: t('queryConfig.resetFailed', { label }),
          });
        },
        onSuccess: () => {
          notifications.show({
            color: 'green',
            message: t('queryConfig.reset', { label }),
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
    t,
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
                placeholder={t('queryConfig.selectPlaceholder')}
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
                  placeholder ||
                  currentValue?.toString() ||
                  t('queryConfig.valuePlaceholder')
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
              {tCommon('actions.save')}
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
              {tCommon('actions.cancel')}
            </Button>
          </Group>
        </form>
      ) : (
        <Group>
          <Text className="text-white">
            {displayValue
              ? displayValue(currentValue, defaultValue)
              : currentValue?.toString() || t('queryConfig.notSet')}
          </Text>
          {hasAdminAccess && (
            <Button
              size="xs"
              variant="secondary"
              leftSection={<IconPencil size={16} />}
              onClick={() => setIsEditing(true)}
            >
              {t('queryConfig.change')}
            </Button>
          )}
          {hasAdminAccess && isCustomValue && defaultValue != null && (
            <Button
              size="xs"
              variant="subtle"
              loading={updateClickhouseSettings.isPending}
              onClick={handleReset}
            >
              {t('queryConfig.resetToDefault')}
            </Button>
          )}
        </Group>
      )}
    </Stack>
  );
}

export default function TeamQueryConfigSection() {
  const { t } = useTranslation('settings');
  const brandName = useBrandDisplayName();
  const displayValueWithUnit =
    (unit: string) => (value: any, defaultValue?: any) =>
      value === undefined || value === defaultValue
        ? t('queryConfig.valueWithUnit', {
            value: defaultValue.toLocaleString(),
            unit,
          })
        : value === 0
          ? t('queryConfig.unlimited')
          : t('queryConfig.valueWithUnit', {
              value: value.toLocaleString(),
              unit,
            });

  return (
    <Box id="team_query_config">
      <Text size="md">{t('sections.queryConfig')}</Text>
      <Divider my="md" />
      <Card>
        <Stack>
          <ClickhouseSettingForm
            settingKey="searchRowLimit"
            label={t('queryConfig.searchRowLimit')}
            tooltip={t('queryConfig.searchRowLimitTooltip')}
            type="number"
            defaultValue={DEFAULT_SEARCH_ROW_LIMIT}
            placeholder={t('queryConfig.searchRowLimitPlaceholder', {
              defaultValue: DEFAULT_SEARCH_ROW_LIMIT,
            })}
            min={1}
            max={100000}
            displayValue={displayValueWithUnit(t('queryConfig.unitRows'))}
          />
          <ClickhouseSettingForm
            settingKey="queryTimeout"
            label={t('queryConfig.queryTimeout')}
            tooltip={t('queryConfig.queryTimeoutTooltip')}
            type="number"
            defaultValue={DEFAULT_QUERY_TIMEOUT}
            placeholder={t('queryConfig.searchRowLimitPlaceholder', {
              defaultValue: DEFAULT_QUERY_TIMEOUT,
            })}
            min={0}
            displayValue={displayValueWithUnit(t('queryConfig.unitSeconds'))}
          />
          <ClickhouseSettingForm
            settingKey="metadataMaxRowsToRead"
            label={t('queryConfig.metadataMaxRowsToRead')}
            tooltip={t('queryConfig.metadataMaxRowsToReadTooltip')}
            type="number"
            defaultValue={DEFAULT_METADATA_MAX_ROWS_TO_READ}
            placeholder={t('queryConfig.searchRowLimitPlaceholder', {
              defaultValue: DEFAULT_METADATA_MAX_ROWS_TO_READ.toLocaleString(),
            })}
            min={0}
            displayValue={displayValueWithUnit(t('queryConfig.unitRows'))}
          />
          <ClickhouseSettingForm
            settingKey="filterKeysFetchLimit"
            label={t('queryConfig.filterKeysFetchLimit')}
            tooltip={t('queryConfig.filterKeysFetchLimitTooltip')}
            type="number"
            defaultValue={DEFAULT_FILTER_KEYS_FETCH_LIMIT}
            placeholder={t('queryConfig.filterKeysFetchLimitPlaceholder', {
              defaultValue: DEFAULT_FILTER_KEYS_FETCH_LIMIT,
            })}
            min={1}
            max={1000}
            displayValue={displayValueWithUnit(t('queryConfig.unitKeys'))}
            description={t('queryConfig.filterKeysFetchLimitDescription', {
              defaultValue: DEFAULT_FILTER_KEYS_FETCH_LIMIT,
            })}
          />
          <ClickhouseSettingForm
            settingKey="fieldMetadataDisabled"
            label={t('queryConfig.fieldMetadata')}
            tooltip={t('queryConfig.fieldMetadataTooltip')}
            type="boolean"
            displayValue={value =>
              value ? t('queryConfig.disabled') : t('queryConfig.enabled')
            }
          />
          <ClickhouseSettingForm
            settingKey="parallelizeWhenPossible"
            label={t('queryConfig.parallelize')}
            tooltip={t('queryConfig.parallelizeTooltip', { brandName })}
            type="boolean"
            displayValue={value =>
              value ? t('queryConfig.enabled') : t('queryConfig.disabled')
            }
          />
        </Stack>
      </Card>
    </Box>
  );
}
