import { useMemo } from 'react';
import { Control, Controller } from 'react-hook-form';
import { WebhookService } from '@hyperdx/common-utils/dist/types';
import { ComboboxData, Group, Select, Stack, Text } from '@mantine/core';
import { IconWebhook } from '@tabler/icons-react';

import api from '@/api';
import { getWebhookChannelIcon } from '@/utils/webhookIcons';
import { getWebhookDetail } from '@/utils/webhooks';

type Webhook = {
  _id: string;
  name: string;
  service?: string;
  url?: string;
  description?: string;
};

// Stable reference so omitting `takenWebhookIds` doesn't create a new array
// (and re-render loop) on every render.
const NO_TAKEN_WEBHOOK_IDS: string[] = [];

export const WebhookChannelForm = ({
  control,
  namePrefix = '',
  takenWebhookIds = NO_TAKEN_WEBHOOK_IDS,
}: {
  control: Control<any>;
  namePrefix?: string;
  /** Webhooks already chosen by the alert's other channels. */
  takenWebhookIds?: string[];
}) => {
  const { data: webhooks } = api.useWebhooks([
    WebhookService.Slack,
    WebhookService.Generic,
    WebhookService.IncidentIO,
  ]);

  const hasWebhooks = Array.isArray(webhooks?.data) && webhooks.data.length > 0;

  const webhookIdField = `${namePrefix}webhookId`;

  const options = useMemo<ComboboxData>(() => {
    const taken = new Set(takenWebhookIds);
    const webhookOptions =
      webhooks?.data.map((sw: Webhook) => ({
        value: sw._id,
        label: sw.name,
        // The API rejects duplicate channels, so don't offer one twice.
        disabled: taken.has(sw._id),
      })) || [];

    return [
      {
        value: '',
        label: 'Select a Webhook',
        disabled: true,
      },
      ...webhookOptions,
    ];
  }, [webhooks, takenWebhookIds]);

  // Which destination a webhook posts to matters when picking one, and the
  // name alone doesn't say. Keyed by id so the option renderer can look it up.
  const serviceById = useMemo(
    () =>
      new Map<string, string | undefined>(
        (webhooks?.data ?? []).map((sw: Webhook) => [sw._id, sw.service]),
      ),
    [webhooks],
  );

  // The webhook's description (or masked URL) so the user can see where each
  // one posts while selecting a destination (issue #1780), rather than picking
  // blind from a list of names.
  const detailById = useMemo(
    () =>
      new Map<string, string | undefined>(
        (webhooks?.data ?? []).map((sw: Webhook) => [
          sw._id,
          getWebhookDetail(sw),
        ]),
      ),
    [webhooks],
  );

  return (
    <Controller
      control={control}
      name={webhookIdField}
      render={({ field, fieldState }) => {
        const selectedDetail = field.value
          ? detailById.get(field.value)
          : undefined;
        return (
          <Stack gap={2} flex={1}>
            <Select
              data-testid="select-webhook"
              comboboxProps={{
                withinPortal: false,
              }}
              required
              size="xs"
              placeholder={
                hasWebhooks ? 'Select a Webhook' : 'No Webhooks available'
              }
              data={options}
              leftSection={
                field.value ? (
                  getWebhookChannelIcon(serviceById.get(field.value))
                ) : (
                  <IconWebhook size={16} />
                )
              }
              renderOption={({ option }) => {
                if (!option.value) {
                  return <span>{option.label}</span>;
                }
                const detail = detailById.get(option.value);
                return (
                  <Group gap="xs" wrap="nowrap">
                    {getWebhookChannelIcon(serviceById.get(option.value))}
                    <div>
                      <span>{option.label}</span>
                      {detail ? (
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {detail}
                        </Text>
                      ) : null}
                    </div>
                  </Group>
                );
              }}
              {...field}
              error={fieldState.error?.message}
            />
            {selectedDetail ? (
              <Text
                size="xs"
                c="dimmed"
                lineClamp={1}
                data-testid="selected-webhook-detail"
              >
                {selectedDetail}
              </Text>
            ) : null}
          </Stack>
        );
      }}
    />
  );
};
