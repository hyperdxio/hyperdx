import { useMemo } from 'react';
import Link from 'next/link';
import { Control } from 'react-hook-form';
import { Select, SelectProps } from 'react-hook-form-mantine';
import type { Alert, AlertChannelType } from '@hyperdx/common-utils/dist/types';
import { Button, ComboboxData, Group } from '@mantine/core';

import api from '@/api';

type Webhook = {
  _id: string;
  name: string;
};

const WebhookChannelForm = <T extends object>(
  props: Partial<SelectProps<T>>,
) => {
  const { data: webhooks } = api.useWebhooks(['slack', 'generic']);

  const hasWebhooks = Array.isArray(webhooks?.data) && webhooks.data.length > 0;

  const options = useMemo<ComboboxData>(() => {
    const webhookOptions =
      webhooks?.data.map((sw: Webhook) => ({
        value: sw._id,
        label: sw.name,
      })) || [];

    return [
      {
        value: '',
        label: 'Select a Webhook',
        disabled: true,
      },
      ...webhookOptions,
    ];
  }, [webhooks]);

  return (
    <div>
      <Group gap="md" justify="space-between">
        <Select
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
          name={props.name!}
          control={props.control}
          {...props}
        />
        <Link href="/team" passHref>
          <Button size="xs" variant="subtle" color="gray">
            Add New Incoming Webhook
          </Button>
        </Link>
      </Group>
    </div>
  );
};

export const AlertChannelForm = ({
  control,
  type,
}: {
  control: Control<Alert>;
  type: AlertChannelType;
}) => {
  if (type === 'webhook') {
    return <WebhookChannelForm control={control} name={`channel.webhookId`} />;
  }

  return null;
};
