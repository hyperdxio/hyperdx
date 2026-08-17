import { useMemo } from 'react';
import { Control, Controller, useWatch } from 'react-hook-form';
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

// The channels array path this channel belongs to, derived from a
// `namePrefix` like "channels.0." -> "channels", so sibling channels can be
// watched for already-chosen webhooks without an extra prop.
const channelsArrayPath = (namePrefix: string) =>
  namePrefix.replace(/\.\d+\.$/, '');

export const WebhookChannelForm = ({
  control,
  namePrefix = '',
}: {
  control: Control<any>;
  namePrefix?: string;
}) => {
  const { data: webhooks } = api.useWebhooks([
    WebhookService.Slack,
    WebhookService.Generic,
    WebhookService.IncidentIO,
  ]);

  const hasWebhooks = Array.isArray(webhooks?.data) && webhooks.data.length > 0;

  const webhookIdField = `${namePrefix}webhookId`;
  const currentWebhookId = useWatch({ control, name: webhookIdField });
  const siblingChannels: unknown = useWatch({
    control,
    name: channelsArrayPath(namePrefix),
  });

  // Webhooks already chosen by the alert's other channels. The API rejects
  // duplicate channels, so don't offer one twice.
  const takenWebhookIds = useMemo(() => {
    const channels = Array.isArray(siblingChannels) ? siblingChannels : [];
    return new Set(
      channels
        .map((c: { webhookId?: unknown }) => c?.webhookId)
        .filter(
          (id): id is string =>
            typeof id === 'string' && !!id && id !== currentWebhookId,
        ),
    );
  }, [siblingChannels, currentWebhookId]);

  const options = useMemo<ComboboxData>(() => {
    const webhookOptions =
      webhooks?.data.map((sw: Webhook) => ({
        value: sw._id,
        label: sw.name,
        disabled: takenWebhookIds.has(sw._id),
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
