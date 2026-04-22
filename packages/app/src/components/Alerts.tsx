import { useMemo } from 'react';
import {
  Control,
  Controller,
  FieldValues,
  Path,
  useController,
} from 'react-hook-form';
import { Label, ReferenceArea, ReferenceLine } from 'recharts';
import {
  type AlertChannelType,
  AlertThresholdType,
  WebhookService,
} from '@hyperdx/common-utils/dist/types';
import { Button, ComboboxData, Group, Modal, Select } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import api from '@/api';

import { WebhookForm } from '../components/TeamSettings/WebhookForm';

type Webhook = {
  _id: string;
  name: string;
};

const WebhookChannelForm = <T extends FieldValues>({
  control,
  name,
}: {
  control?: Control<T>;
  name?: string;
}) => {
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
    control,
    name: name! as Path<T>,
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
      <Group gap="md" justify="space-between" align="flex-start">
        <Controller
          control={control}
          name={name! as Path<T>}
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
              {...field}
              error={fieldState.error?.message}
            />
          )}
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

export const AlertChannelForm = <T extends FieldValues>({
  control,
  type,
  namePrefix = '',
}: {
  control: Control<T>;
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
  thresholdMax,
  // TODO: zScore
}: {
  thresholdType: AlertThresholdType;
  threshold: number;
  thresholdMax?: number;
}) => {
  if (threshold == null) {
    return null;
  }
  if (thresholdType === AlertThresholdType.BETWEEN && thresholdMax != null) {
    return (
      <ReferenceArea
        y1={threshold}
        y2={thresholdMax}
        ifOverflow="extendDomain"
        fill="red"
        strokeWidth={0}
        fillOpacity={0.05}
      />
    );
  }
  if (
    thresholdType === AlertThresholdType.NOT_BETWEEN &&
    thresholdMax != null
  ) {
    return [
      <ReferenceArea
        key="not-between-lower"
        y2={threshold}
        ifOverflow="extendDomain"
        fill="red"
        strokeWidth={0}
        fillOpacity={0.05}
      />,
      <ReferenceArea
        key="not-between-upper"
        y1={thresholdMax}
        ifOverflow="extendDomain"
        fill="red"
        strokeWidth={0}
        fillOpacity={0.05}
      />,
    ];
  }
  if (
    thresholdType === AlertThresholdType.BELOW ||
    thresholdType === AlertThresholdType.BELOW_OR_EQUAL
  ) {
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
  if (
    thresholdType === AlertThresholdType.ABOVE ||
    thresholdType === AlertThresholdType.ABOVE_EXCLUSIVE
  ) {
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
  // For 'equal' and 'not_equal', show a reference line at the threshold
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
};
