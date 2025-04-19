import { useMemo } from 'react';
import { Control, useController } from 'react-hook-form';
import { Select, SelectProps } from 'react-hook-form-mantine';
import { Label, ReferenceArea, ReferenceLine } from 'recharts';
import type { AlertChannelType } from '@hyperdx/common-utils/dist/types';
import { Button, ComboboxData, Group, Modal } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import api from '@/api';

import { CreateWebhookForm } from '../TeamPage';

type Webhook = {
  _id: string;
  name: string;
};

const WebhookChannelForm = <T extends object>(
  props: Partial<SelectProps<T>>,
) => {
  const { data: webhooks, refetch: refetchWebhooks } = api.useWebhooks([
    'slack',
    'generic',
  ]);
  const [opened, { open, close }] = useDisclosure(false);

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

  const { field } = useController({
    control: props.control,
    name: props.name!,
  });

  const handleWebhookCreated = async (webhookId: string) => {
    await refetchWebhooks();
    field.onChange(webhookId);
    field.onBlur();
    close();
  };

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
        <Button size="xs" variant="subtle" color="gray" onClick={open}>
          Add New Incoming Webhook
        </Button>
      </Group>

      <Modal
        opened={opened}
        onClose={close}
        title="Add New Webhook"
        centered
        zIndex={9999}
        size="lg"
      >
        <CreateWebhookForm onClose={close} onSuccess={handleWebhookCreated} />
      </Modal>
    </div>
  );
};

export const AlertChannelForm = ({
  control,
  type,
  namePrefix = '',
}: {
  control: Control<any>; // TODO: properly type this
  type: AlertChannelType;
  namePrefix?: string;
}) => {
  if (type === 'webhook') {
    return (
      <WebhookChannelForm
        control={control}
        name={`${namePrefix}channel.webhookId`}
      />
    );
  }

  return null;
};

export const getAlertReferenceLines = ({
  thresholdType,
  threshold,
  // TODO: zScore
}: {
  thresholdType: 'above' | 'below';
  threshold: number;
}) => (
  <>
    {threshold != null && thresholdType === 'below' && (
      <ReferenceArea
        y1={0}
        y2={threshold}
        ifOverflow="extendDomain"
        fill="red"
        strokeWidth={0}
        fillOpacity={0.05}
      />
    )}
    {threshold != null && thresholdType === 'above' && (
      <ReferenceArea
        y1={threshold}
        ifOverflow="extendDomain"
        fill="red"
        strokeWidth={0}
        fillOpacity={0.05}
      />
    )}
    {threshold != null && (
      <ReferenceLine
        y={threshold}
        label={
          <Label
            value="Alert Threshold"
            fill={'white'}
            fontSize={11}
            opacity={0.7}
          />
        }
        stroke="red"
        strokeDasharray="3 3"
      />
    )}
  </>
);
