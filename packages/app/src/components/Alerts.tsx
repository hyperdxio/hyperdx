import { useMemo } from 'react';
import { Control, useController } from 'react-hook-form';
import { Select, SelectProps } from 'react-hook-form-mantine';
import { Label, ReferenceArea, ReferenceLine } from 'recharts';
import {
  type AlertChannelType,
  WebhookService,
} from '@hyperdx/common-utils/dist/types';
import { Button, ComboboxData, Group, Modal } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import api from '@/api';

import { WebhookForm } from '../components/TeamSettings/WebhookForm';

type Webhook = {
  _id: string;
  name: string;
};

const WebhookChannelForm = <T extends object>(
  props: Partial<SelectProps<T>>,
) => {
  const { data: webhooks, refetch: refetchWebhooks } = api.useWebhooks([
    WebhookService.Slack,
    WebhookService.Generic,
    WebhookService.IncidentIO,
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

  const handleWebhookCreated = async (webhookId?: string) => {
    await refetchWebhooks();
    if (webhookId) {
      field.onChange(webhookId);
      field.onBlur();
    }
    close();
  };

  return (
    <div>
      <Group gap="md" justify="space-between">
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
          name={props.name!}
          control={props.control}
          {...props}
        />
        <Button
          data-testid="add-new-webhook-button"
          size="xs"
          variant="subtle"
          color="gray"
          onClick={open}
        >
          Add New Incoming Webhook
        </Button>
      </Group>

      <Modal
        data-testid="alert-modal"
        opened={opened}
        onClose={close}
        title="Add New Webhook"
        centered
        zIndex={9999}
        size="lg"
      >
        <WebhookForm onClose={close} onSuccess={handleWebhookCreated} />
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
}) => {
  if (threshold != null && thresholdType === 'below') {
    return (
      <ReferenceArea
        y1={0}
        y2={threshold}
        ifOverflow="extendDomain"
        fill="red"
        strokeWidth={0}
        fillOpacity={0.05}
      />
    );
  }
  if (threshold != null && thresholdType === 'above') {
    return (
      <ReferenceArea
        y1={threshold}
        ifOverflow="extendDomain"
        fill="red"
        strokeWidth={0}
        fillOpacity={0.05}
      />
    );
  }
  if (threshold != null) {
    return (
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
    );
  }
  return null;
};
