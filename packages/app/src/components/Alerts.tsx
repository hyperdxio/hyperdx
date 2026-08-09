import { useMemo } from 'react';
import {
  ArrayPath,
  Control,
  Controller,
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
import {
  ActionIcon,
  Button,
  ComboboxData,
  Group,
  Modal,
  Select,
  Stack,
  Text,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus, IconTrash, IconWebhook } from '@tabler/icons-react';

import api from '@/api';
import { WebhookForm } from '@/components/TeamSettings/WebhookForm';
import { getWebhookChannelIcon } from '@/utils/webhookIcons';

type Webhook = {
  _id: string;
  name: string;
  service?: string;
};

const useAlertWebhooks = () =>
  api.useWebhooks([
    WebhookService.Slack,
    WebhookService.Generic,
    WebhookService.IncidentIO,
  ]);

const WebhookChannelForm = <T extends FieldValues>({
  control,
  name,
  onRemove,
  takenWebhookIds,
}: {
  control?: Control<T>;
  name?: string;
  onRemove?: () => void;
  /** Webhooks already chosen by the alert's other channels. */
  takenWebhookIds?: string[];
}) => {
  const { data: webhooks } = useAlertWebhooks();

  const hasWebhooks = Array.isArray(webhooks?.data) && webhooks.data.length > 0;

  const options = useMemo<ComboboxData>(() => {
    const taken = new Set(takenWebhookIds ?? []);
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
    <Group gap="md" align="flex-start" wrap="nowrap">
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
      {onRemove && (
        <ActionIcon
          data-testid="remove-webhook-channel-button"
          aria-label="Remove notification channel"
          size="md"
          variant="danger"
          onClick={onRemove}
        >
          <IconTrash size={14} />
        </ActionIcon>
      )}
    </Group>
  );
};

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

  const newChannel = () =>
    ({ type: 'webhook', webhookId: '' }) as FieldArray<T, ArrayPath<T>>;

  // A webhook created from here lands in the first empty row, or a new one if
  // every row is already filled — so the user never has to re-pick it.
  const handleWebhookCreated = async (webhookId?: string) => {
    await refetchWebhooks();
    if (webhookId) {
      const emptyIndex = selectedWebhookIds.findIndex(id => !id);
      const value = { type: 'webhook', webhookId } as FieldArray<
        T,
        ArrayPath<T>
      >;
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
        <WebhookChannelForm
          key={field.id}
          control={control}
          name={`${channelsName}.${index}.webhookId`}
          takenWebhookIds={selectedWebhookIds.filter(
            (id, i) => i !== index && !!id,
          )}
          // A single channel is not removable: an alert with no target would
          // fire into the void, and the API rejects it anyway.
          onRemove={fields.length > 1 ? () => remove(index) : undefined}
        />
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
