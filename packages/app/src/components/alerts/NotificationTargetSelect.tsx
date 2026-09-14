import { useMemo } from 'react';
import _ from 'lodash';
import { Control, useController } from 'react-hook-form';
import { WebhookService } from '@hyperdx/common-utils/dist/types';
import {
  ComboboxItem,
  ComboboxParsedItem,
  Group,
  Select,
  SelectProps,
} from '@mantine/core';
import { IconBell } from '@tabler/icons-react';

import api from '@/api';
import { IS_MANAGED_AGENTS_ENABLED } from '@/config';
import { ClaudeCodeIcon } from '@/SVGIcons';
import { getWebhookChannelIcon } from '@/utils/webhookIcons';

// One dropdown for every kind of notification target an alert can send to —
// webhooks and AI agents in one grouped, searchable list — writing the whole
// discriminated channel object (`{type:'webhook',webhookId}` /
// `{type:'agent',agentId}`) back to the form. Option values are composite
// `kind:id` strings because a Select holds one string per option.
type TargetKind = 'webhook' | 'agent';

const toValue = (kind: TargetKind, id: string) => `${kind}:${id}`;

const fromValue = (value: string): { kind: TargetKind; id: string } => {
  const sep = value.indexOf(':');
  return {
    kind: value.slice(0, sep) as TargetKind,
    id: value.slice(sep + 1),
  };
};

/** Composite `kind:id` for a channel row, or null for an unset/foreign row. */
export const channelTargetKey = (channel?: {
  type?: string | null;
  webhookId?: string;
  agentId?: string;
}): string | null => {
  if (channel?.type === 'webhook' && channel.webhookId) {
    return toValue('webhook', channel.webhookId);
  }
  if (channel?.type === 'agent' && channel.agentId) {
    return toValue('agent', channel.agentId);
  }
  return null;
};

// Stable reference so omitting `takenKeys` doesn't create a new array (and
// re-render loop) on every render.
const NO_TAKEN_KEYS: string[] = [];

export const NotificationTargetSelect = ({
  control,
  name,
  takenKeys = NO_TAKEN_KEYS,
}: {
  control: Control<any>;
  /** Path of the channel row object, e.g. "channels.0". */
  name: string;
  /** Composite keys (`kind:id`) already chosen by the alert's other rows. */
  takenKeys?: string[];
}) => {
  const { data: webhooks } = api.useWebhooks([
    WebhookService.Slack,
    WebhookService.Generic,
    WebhookService.IncidentIO,
  ]);
  const { data: agents } = api.useManagedAgents({
    enabled: IS_MANAGED_AGENTS_ENABLED,
  });

  const { field, fieldState } = useController({ control, name });
  // The row is an object, so a validation message lands on whichever id
  // subfield the channel's type requires (zod reports at `channels.N.webhookId`
  // / `.agentId`), or on the row itself. `_.get` rather than a cast: the error
  // for an object field is loosely typed as FieldError.
  const errorMessage =
    _.get(fieldState.error, 'webhookId.message') ??
    _.get(fieldState.error, 'agentId.message') ??
    fieldState.error?.message;

  const webhookList = useMemo(() => webhooks?.data ?? [], [webhooks]);
  const agentList = useMemo(
    () => (IS_MANAGED_AGENTS_ENABLED ? (agents?.data ?? []) : []),
    [agents],
  );

  // value -> extra search keywords, so "slack", "ai" or "claude" match targets
  // whose names never mention their kind.
  const { data, keywordsByValue, iconByValue } = useMemo(() => {
    const taken = new Set(takenKeys);
    const keywordsByValue = new Map<string, string>();
    const iconByValue = new Map<string, React.ReactNode>();

    const webhookItems: ComboboxItem[] = webhookList.map(w => {
      const value = toValue('webhook', w._id);
      keywordsByValue.set(value, `webhook ${w.service ?? ''}`.toLowerCase());
      iconByValue.set(value, getWebhookChannelIcon(w.service));
      // The API rejects duplicate channels, so don't offer one twice.
      return { value, label: w.name, disabled: taken.has(value) };
    });
    const agentItems: ComboboxItem[] = agentList.map(a => {
      const value = toValue('agent', a._id);
      keywordsByValue.set(
        value,
        `ai agent claude anthropic ${a.model ?? ''}`.trim().toLowerCase(),
      );
      iconByValue.set(value, <ClaudeCodeIcon width={16} />);
      return { value, label: a.name, disabled: taken.has(value) };
    });

    const data = [
      ...(webhookItems.length > 0
        ? [{ group: 'Webhooks', items: webhookItems }]
        : []),
      ...(agentItems.length > 0
        ? [{ group: 'AI agents', items: agentItems }]
        : []),
    ];
    return { data, keywordsByValue, iconByValue };
  }, [webhookList, agentList, takenKeys]);

  const selectedValue = channelTargetKey(field.value);

  // A stored target that isn't in `data` — a deleted webhook, or an agent
  // channel written through the API while this build has agents switched off
  // — would otherwise render as a blank required row, and the next pick would
  // silently overwrite it. Show it instead, so replacing it is a choice.
  const { options, isDangling } = useMemo(() => {
    if (!selectedValue) return { options: data, isDangling: false };
    const known = data.some(group =>
      group.items.some(item => item.value === selectedValue),
    );
    if (known) return { options: data, isDangling: false };
    const { kind } = fromValue(selectedValue);
    return {
      options: [
        ...data,
        {
          group: 'Currently set',
          items: [
            {
              value: selectedValue,
              label:
                kind === 'agent'
                  ? 'AI agent (unavailable)'
                  : 'Webhook (unavailable)',
            },
          ],
        },
      ],
      isDangling: true,
    };
  }, [data, selectedValue]);

  const hasTargets = options.length > 0;

  // Matches the visible name OR the hidden kind keywords ("slack", "ai", ...).
  const filter: SelectProps['filter'] = ({ options, search }) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return options;
    const matches = (item: ComboboxItem) =>
      item.label.toLowerCase().includes(needle) ||
      (keywordsByValue.get(item.value) ?? '').includes(needle);
    return options.reduce<ComboboxParsedItem[]>((acc, option) => {
      if ('group' in option) {
        const items = option.items.filter(matches);
        if (items.length > 0) acc.push({ ...option, items });
      } else if (matches(option)) {
        acc.push(option);
      }
      return acc;
    }, []);
  };

  return (
    <Select
      // Keeps the testid the E2E page objects already target; the row now
      // selects any notification target, webhooks included.
      data-testid="select-webhook"
      comboboxProps={{ withinPortal: false }}
      required
      size="xs"
      flex={1}
      searchable
      filter={filter}
      nothingFoundMessage="No matching targets"
      placeholder={
        hasTargets ? 'Select a notification target' : 'No targets available'
      }
      data={options}
      value={selectedValue}
      onChange={value => {
        if (!value) return;
        const { kind, id } = fromValue(value);
        field.onChange(
          kind === 'agent'
            ? { type: 'agent', agentId: id }
            : { type: 'webhook', webhookId: id },
        );
      }}
      onBlur={field.onBlur}
      leftSection={
        selectedValue && !isDangling ? (
          iconByValue.get(selectedValue)
        ) : (
          <IconBell size={16} />
        )
      }
      renderOption={({ option }) => (
        <Group gap="xs" wrap="nowrap">
          {iconByValue.get(option.value)}
          <span>{option.label}</span>
        </Group>
      )}
      error={errorMessage ? String(errorMessage) : undefined}
    />
  );
};
