import { useMemo } from 'react';
import {
  ArrayPath,
  Control,
  FieldArray,
  FieldValues,
  Path,
  useFieldArray,
  useWatch,
} from 'react-hook-form';
import { Label, ReferenceArea, ReferenceLine } from 'recharts';
import {
  type AlertChannelType,
  AlertThresholdType,
  MAX_ALERT_CHANNELS,
  WebhookService,
} from '@hyperdx/common-utils/dist/types';
import { ActionIcon, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus, IconTrash, IconWebhook } from '@tabler/icons-react';

import api from '@/api';
import { WebhookChannelForm } from '@/components/alerts/WebhookChannelForm';
import { WebhookForm } from '@/components/TeamSettings/WebhookForm';

const useAlertWebhooks = () =>
  api.useWebhooks([
    WebhookService.Slack,
    WebhookService.Generic,
    WebhookService.IncidentIO,
  ]);

// react-hook-form's `FieldArray<T, ArrayPath<T>>` depends on the caller's
// generic form type, which TypeScript can't verify a plain object literal
// against here. Centralized so that unavoidable assertion exists once
// instead of at every call site.
function makeWebhookChannel<T extends FieldValues>(
  webhookId: string,
): FieldArray<T, ArrayPath<T>> {
  return { type: 'webhook', webhookId } as FieldArray<T, ArrayPath<T>>;
}

export const AlertChannelForm = <T extends FieldValues>({
  control,
  type,
  channelsName,
}: {
  control: Control<T>;
  type: AlertChannelType;
  /** Path of the alert's channels array, e.g. "channels" or "alert.channels". */
  channelsName: ArrayPath<T> & Path<T>;
}) => {
  const { fields, append, remove, update } = useFieldArray<T>({
    control,
    name: channelsName,
  });
  // `fields` holds the values from the last render, so watch for the live ones
  // the duplicate check needs.
  const channels = useWatch({ control, name: channelsName }) as
    | { webhookId?: string }[]
    | undefined;
  const { refetch: refetchWebhooks } = useAlertWebhooks();
  const [opened, { open, close }] = useDisclosure(false);

  const selectedWebhookIds = useMemo(
    () => (channels ?? []).map(c => c?.webhookId ?? ''),
    [channels],
  );

  const newChannel = () => makeWebhookChannel<T>('');

  // A webhook created from here lands in the first empty row, or a new one if
  // every row is already filled — so the user never has to re-pick it.
  const handleWebhookCreated = async (webhookId?: string) => {
    await refetchWebhooks();
    if (webhookId) {
      const emptyIndex = selectedWebhookIds.findIndex(id => !id);
      const value = makeWebhookChannel<T>(webhookId);
      if (emptyIndex >= 0) {
        update(emptyIndex, value);
      } else if (fields.length < MAX_ALERT_CHANNELS) {
        append(value);
      }
    }
    close();
  };

  if (type !== 'webhook') {
    return null;
  }

  return (
    <Stack gap="xs">
      {fields.map((field, index) => (
        <Group key={field.id} gap="md" align="flex-start" wrap="nowrap">
          <WebhookChannelForm
            control={control}
            namePrefix={`${channelsName}.${index}.`}
          />
          {/* A single channel is not removable: an alert with no target
              would fire into the void, and the API rejects it anyway. */}
          {fields.length > 1 && (
            <ActionIcon
              data-testid="remove-webhook-channel-button"
              aria-label="Remove notification channel"
              size="md"
              variant="danger"
              onClick={() => remove(index)}
            >
              <IconTrash size={14} />
            </ActionIcon>
          )}
        </Group>
      ))}
      <Group gap="xs">
        <Button
          data-testid="add-alert-channel-button"
          size="xs"
          variant="subtle"
          color="gray"
          leftSection={<IconPlus size={14} />}
          disabled={fields.length >= MAX_ALERT_CHANNELS}
          onClick={() => append(newChannel())}
        >
          Add another channel
        </Button>
        <Button
          data-testid="add-new-webhook-button"
          size="xs"
          variant="subtle"
          color="gray"
          leftSection={<IconWebhook size={14} />}
          onClick={open}
        >
          Add New Incoming Webhook
        </Button>
        {fields.length >= MAX_ALERT_CHANNELS && (
          <Text size="xs" opacity={0.5}>
            Limit of {MAX_ALERT_CHANNELS} channels reached
          </Text>
        )}
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
    </Stack>
  );
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
