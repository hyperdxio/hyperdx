import { useMemo } from 'react';
import { Control, Controller } from 'react-hook-form';
import { WebhookService } from '@hyperdx/common-utils/dist/types';
import { ComboboxData, Group, Select } from '@mantine/core';
import { IconWebhook } from '@tabler/icons-react';

import api from '@/api';
import { getWebhookChannelIcon } from '@/utils/webhookIcons';

type Webhook = {
  _id: string;
  name: string;
  service?: string;
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

  return (
    <Controller
      control={control}
      name={webhookIdField}
      render={({ field, fieldState }) => (
        <Select
          data-testid="select-webhook"
          comboboxProps={{
            withinPortal: false,
          }}
          required
          size="xs"
          flex={1}
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
          renderOption={({ option }) =>
            option.value ? (
              <Group gap="xs" wrap="nowrap">
                {getWebhookChannelIcon(serviceById.get(option.value))}
                <span>{option.label}</span>
              </Group>
            ) : (
              <span>{option.label}</span>
            )
          }
          {...field}
          error={fieldState.error?.message}
        />
      )}
    />
  );
};
