import Link from 'next/link';
import { Select, SelectProps } from 'react-hook-form-mantine';
import { Button, Group } from '@mantine/core';

import api from '@/api';

export const WebhookChannelForm = <T extends object>(
  props: Partial<SelectProps<T>>,
) => {
  const { data: webhooks } = api.useWebhooks(['slack', 'generic']);

  const hasWebhooks = Array.isArray(webhooks?.data) && webhooks.data.length > 0;

  return (
    <div>
      <Group gap="md" justify="space-between">
        <Select
          required
          size="xs"
          flex={1}
          placeholder={
            hasWebhooks ? 'Select a Webhook' : 'No Webhooks available'
          }
          data={webhooks?.data.map((sw: any) => ({
            value: sw._id,
            label: sw.name,
          }))}
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
