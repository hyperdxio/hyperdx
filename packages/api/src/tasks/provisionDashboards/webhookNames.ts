import { Tile } from '@hyperdx/common-utils/dist/types';

import Webhook from '@/models/webhook';

// A file names a webhook with `{ "type": "webhook", "webhookName": "..." }`,
// since webhook ids differ per team and per install. Names only resolve per
// team, after the file is parsed, so until then the name rides in `webhookId`
// behind this prefix. It never reaches Mongo: resolveWebhookNames swaps it for
// the real id, or drops the alert from the stored tile.
const WEBHOOK_NAME_REF = 'webhook-name:';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

function encodeWebhookName(channel: unknown): unknown {
  if (
    !isRecord(channel) ||
    typeof channel.webhookName !== 'string' ||
    'webhookId' in channel
  ) {
    return channel;
  }
  const { webhookName, ...rest } = channel;
  return { ...rest, webhookId: `${WEBHOOK_NAME_REF}${webhookName}` };
}

export function encodeWebhookNames(raw: unknown): unknown {
  if (!isRecord(raw) || !Array.isArray(raw.tiles)) return raw;
  for (const tile of raw.tiles) {
    const alert =
      isRecord(tile) && isRecord(tile.config) ? tile.config.alert : undefined;
    if (!isRecord(alert)) continue;
    if ('channel' in alert) alert.channel = encodeWebhookName(alert.channel);
    if (Array.isArray(alert.channels)) {
      alert.channels = alert.channels.map(encodeWebhookName);
    }
  }
  return raw;
}

type AlertChannelInput = { type: 'webhook'; webhookId: string };

const alertChannels = (tile: Tile): AlertChannelInput[] => {
  const alert = tile.config.alert;
  return [
    ...(alert?.channel ? [alert.channel] : []),
    ...(alert?.channels ?? []),
  ];
};

export const hasWebhookNames = (tiles: Tile[]) =>
  tiles.some(tile =>
    alertChannels(tile).some(c => c.webhookId.startsWith(WEBHOOK_NAME_REF)),
  );

export async function loadWebhookIdsByName(teamId: string) {
  const webhookIdsByName = new Map<string, string[]>();
  const webhooks = await Webhook.find({ team: teamId }, { name: 1 }).lean();
  for (const webhook of webhooks) {
    const ids = webhookIdsByName.get(webhook.name) ?? [];
    ids.push(webhook._id.toString());
    webhookIdsByName.set(webhook.name, ids);
  }
  return webhookIdsByName;
}

// Swaps each `webhookName` reference for the id of the team's webhook with
// that name. A tile whose alert names a missing or ambiguous webhook loses its
// alert, and is reported in `unresolved`.
export function resolveWebhookNames(
  tiles: Tile[],
  webhookIdsByName: Map<string, string[]>,
): { tiles: Tile[]; unresolved: Map<string, string> } {
  const unresolved = new Map<string, string>();
  const resolveChannel = (channel: AlertChannelInput): AlertChannelInput => {
    if (!channel.webhookId.startsWith(WEBHOOK_NAME_REF)) return channel;
    const name = channel.webhookId.slice(WEBHOOK_NAME_REF.length);
    const ids = webhookIdsByName.get(name) ?? [];
    if (ids.length === 0) {
      throw new Error(`Webhook named "${name}" not found`);
    }
    if (ids.length > 1) {
      throw new Error(
        `Webhook name "${name}" matches ${ids.length} webhooks; use webhookId`,
      );
    }
    return { ...channel, webhookId: ids[0] };
  };

  const resolved = tiles.map((tile): Tile => {
    const alert = tile.config.alert;
    if (alert == null) return tile;
    try {
      return {
        ...tile,
        config: {
          ...tile.config,
          alert: {
            ...alert,
            ...(alert.channel && { channel: resolveChannel(alert.channel) }),
            ...(alert.channels && {
              channels: alert.channels.map(resolveChannel),
            }),
          },
        },
      };
    } catch (err) {
      unresolved.set(tile.id, err instanceof Error ? err.message : String(err));
      return withoutAlert(tile);
    }
  });
  return { tiles: resolved, unresolved };
}

export const withoutAlert = (tile: Tile): Tile => {
  const { alert: _alert, ...config } = tile.config;
  return { ...tile, config };
};
