import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { formatDate, objectHash } from '@hyperdx/common-utils/dist/core/utils';
import {
  AlertChannelType,
  AlertThresholdType,
  ChartConfigWithOptDateRange,
  DisplayType,
  isRangeThresholdType,
  pickSampleWeightExpressionProps,
  SourceKind,
  zAlertChannelType,
} from '@hyperdx/common-utils/dist/types';
import Handlebars, { HelperOptions } from 'handlebars';
import _ from 'lodash';
import PromisedHandlebars from 'promised-handlebars';
import { serializeError } from 'serialize-error';
import { z } from 'zod';

import { AlertInput } from '@/controllers/alerts';
import {
  AlertChannel,
  AlertSource,
  AlertState,
  getAlertChannels,
} from '@/models/alert';
import { IDashboard } from '@/models/dashboard';
import { ISavedSearch } from '@/models/savedSearch';
import { ISource } from '@/models/source';
import { IWebhook } from '@/models/webhook';
import {
  computeAliasWithClauses,
  doesExceedThreshold,
} from '@/tasks/checkAlerts';
import {
  NotificationCapExceededError,
  UnsupportedMentionError,
  WebhookNotFoundError,
} from '@/tasks/checkAlerts/errors';
import {
  inlineNotificationDispatcher,
  NotificationDispatcher,
  NotificationJob,
} from '@/tasks/checkAlerts/notifications';
import {
  AlertProvider,
  PopulatedAlertChannel,
} from '@/tasks/checkAlerts/providers';
import { createHandlebarsWithHelpers } from '@/tasks/checkAlerts/transports';
import { unflattenObject } from '@/tasks/util';
import { truncateString } from '@/utils/common';
import { getCounter } from '@/utils/instrumentation';
import logger from '@/utils/logger';

const describeThresholdViolation = (
  thresholdType: AlertThresholdType,
): string => {
  switch (thresholdType) {
    case AlertThresholdType.ABOVE:
      return 'meets or exceeds';
    case AlertThresholdType.ABOVE_EXCLUSIVE:
      return 'exceeds';
    case AlertThresholdType.BELOW:
      return 'falls below';
    case AlertThresholdType.BELOW_OR_EQUAL:
      return 'falls to or below';
    case AlertThresholdType.EQUAL:
      return 'equals';
    case AlertThresholdType.NOT_EQUAL:
      return 'does not equal';
    case AlertThresholdType.BETWEEN:
      return 'falls between';
    case AlertThresholdType.NOT_BETWEEN:
      return 'falls outside';
  }
};

const describeThresholdResolution = (
  thresholdType: AlertThresholdType,
): string => {
  switch (thresholdType) {
    case AlertThresholdType.ABOVE:
      return 'falls below';
    case AlertThresholdType.ABOVE_EXCLUSIVE:
      return 'falls to or below';
    case AlertThresholdType.BELOW:
      return 'meets or exceeds';
    case AlertThresholdType.BELOW_OR_EQUAL:
      return 'exceeds';
    case AlertThresholdType.EQUAL:
      return 'does not equal';
    case AlertThresholdType.NOT_EQUAL:
      return 'equals';
    case AlertThresholdType.BETWEEN:
      return 'falls outside';
    case AlertThresholdType.NOT_BETWEEN:
      return 'falls between';
  }
};

const describeThreshold = (alert: AlertInput): string => {
  return isRangeThresholdType(alert.thresholdType)
    ? `${alert.threshold} and ${alert.thresholdMax ?? '?'}`
    : `${alert.threshold}`;
};

// An inline alert keeps its query on the alert itself rather than behind a
// saved search, so reading only `savedSearch.where` leaves `{{sourceQuery}}`
// empty for it. A tile alert stays empty: its query lives on the dashboard
// tile, which the render path doesn't load.
const describeSourceQuery = (
  alert: AlertInput,
  savedSearch?: ISavedSearch | null,
): string => {
  if (alert.source === AlertSource.INLINE) {
    const config = alert.chartConfig;
    if (config == null) {
      return '';
    }
    // Same discriminator as isRawSqlSavedChartConfig, inlined because that
    // guard narrows to a SavedChartConfig member and so cannot narrow this
    // union's builder branch.
    return ('configType' in config ? config.sqlTemplate : config.where) ?? '';
  }
  return savedSearch?.where ?? '';
};

// Mappings for the enriched webhook template variables. These turn internal
// enums into stable, consumer-friendly strings a receiver can branch on
// without knowing HyperDX's internals.
const ALERT_STATUS_BY_STATE: Record<AlertState, string> = {
  [AlertState.ALERT]: 'firing',
  [AlertState.OK]: 'resolved',
  [AlertState.INSUFFICIENT_DATA]: 'no_data',
  [AlertState.DISABLED]: 'no_data',
  [AlertState.PENDING]: 'pending',
  [AlertState.ERROR]: 'error',
};

const COMPARATOR_BY_THRESHOLD_TYPE: Record<AlertThresholdType, string> = {
  [AlertThresholdType.ABOVE]: '>=',
  [AlertThresholdType.ABOVE_EXCLUSIVE]: '>',
  [AlertThresholdType.BELOW]: '<',
  [AlertThresholdType.BELOW_OR_EQUAL]: '<=',
  [AlertThresholdType.EQUAL]: '=',
  [AlertThresholdType.NOT_EQUAL]: '!=',
  [AlertThresholdType.BETWEEN]: 'between',
  [AlertThresholdType.NOT_BETWEEN]: 'outside',
};

const ALERT_TYPE_BY_SOURCE: Record<AlertSource, string> = {
  [AlertSource.SAVED_SEARCH]: 'search',
  [AlertSource.TILE]: 'dashboard_chart',
  // Detached alert: the chart config lives on the alert itself, so there is
  // no saved search or tile behind it to open.
  [AlertSource.INLINE]: 'inline_query',
};

const MAX_MESSAGE_LENGTH = 500;
const NOTIFY_FN_NAME = '__hdx_notify_channel__';
const IS_MATCH_FN_NAME = 'is_match';

// Bounds how many targets one fire/resolve event can notify, counting
// configured channels and @webhook- mentions together. Distinct from
// MAX_ALERT_CHANNELS (packages/common-utils), which caps how many channels an
// alert can be configured with; this caps the per-event fan-out, which also
// includes ad hoc @mentions written into the message.
const MAX_NOTIFICATIONS_PER_EVENT = 20;

// A skipped target must be visible operationally even if nobody reads the
// per-target execution error — see recordPreFailure below for the user-facing side.
const notificationCapExceededCounter = getCounter(
  'hyperdx.alerts.notification_cap_exceeded',
  {
    description:
      'Count of alert notification targets dropped because MAX_NOTIFICATIONS_PER_EVENT was reached, labeled by channel_type.',
  },
);

const zNotifyFnParams = z.object({
  hash: z.object({
    channel: zAlertChannelType,
    id: z.string(),
  }),
});

// should match the external alert schema
export type AlertMessageTemplateDefaultView = {
  alert: AlertInput;
  attributes: ReturnType<typeof unflattenObject>;
  dashboard?: IDashboard | null;
  endTime: Date;
  granularity: string;
  group?: string;
  isGroupedAlert: boolean;
  savedSearch?: ISavedSearch | null;
  source?: ISource | null;
  startTime: Date;
  value: number;
};

export const isAlertResolved = (state?: AlertState): boolean => {
  return state === AlertState.OK;
};

/**
 * Formats the value to match the decimal precision of the threshold.
 * This ensures consistent display of numbers in alert messages.
 * Uses Intl.NumberFormat for better precision handling with large numbers.
 */
export const formatValueToMatchThreshold = (
  value: number,
  threshold: number,
): string => {
  // Format threshold with NumberFormat to get its string representation
  const thresholdFormatted = new Intl.NumberFormat('en-US', {
    maximumSignificantDigits: 21,
    useGrouping: false,
  }).format(threshold);

  // Count decimal places in the formatted threshold
  const decimalIndex = thresholdFormatted.indexOf('.');
  const decimalPlaces =
    decimalIndex === -1 ? 0 : thresholdFormatted.length - decimalIndex - 1;

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
    useGrouping: false,
  }).format(value);
};

export const buildAlertMessageTemplateHdxLink = (
  alertProvider: AlertProvider,
  {
    alert,
    dashboard,
    endTime,
    granularity,
    savedSearch,
    startTime,
  }: AlertMessageTemplateDefaultView,
) => {
  if (alert.source === AlertSource.SAVED_SEARCH) {
    if (savedSearch == null) {
      throw new Error(`Source is ${alert.source} but savedSearch is null`);
    }
    return alertProvider.buildLogSearchLink({
      endTime,
      savedSearch,
      startTime,
    });
  } else if (alert.source === AlertSource.TILE) {
    if (dashboard == null) {
      throw new Error(`Source is ${alert.source} but dashboard is null`);
    }
    return alertProvider.buildChartLink({
      dashboardId: dashboard.id,
      endTime,
      granularity,
      startTime,
      tileId: alert.tileId ?? undefined,
    });
  } else if (alert.source === AlertSource.INLINE) {
    if (alert.chartConfig == null) {
      throw new Error(`Source is ${alert.source} but chartConfig is null`);
    }
    // Inline alerts have no saved search or dashboard to open — link to the
    // chart explorer seeded with the alert's persisted config.
    return alertProvider.buildChartExplorerLink({
      chartConfig: alert.chartConfig,
      endTime,
      granularity,
      startTime,
    });
  }

  throw new Error(`Unsupported alert source: ${alert.source}`);
};

export const buildAlertMessageTemplateTitle = ({
  template,
  view,
  state,
}: {
  template?: string | null;
  view: AlertMessageTemplateDefaultView;
  state?: AlertState;
}) => {
  const { alert, dashboard, savedSearch, value } = view;
  const handlebars = createHandlebarsWithHelpers();

  // Add emoji prefix based on alert state
  const emoji = isAlertResolved(state) ? '✅ ' : '🚨 ';

  if (alert.source === AlertSource.SAVED_SEARCH) {
    if (savedSearch == null) {
      throw new Error(`Source is ${alert.source}  but savedSearch is null`);
    }
    // TODO: using template engine to render the title
    const baseTitle = template
      ? handlebars.compile(template)(view)
      : `Alert for "${savedSearch.name}" - ${value} lines found`;
    return `${emoji}${baseTitle}`;
  } else if (alert.source === AlertSource.TILE) {
    if (dashboard == null) {
      throw new Error(`Source is ${alert.source} but dashboard is null`);
    }
    const tile = dashboard.tiles.find(t => t.id === alert.tileId);
    if (!tile) {
      throw new Error(
        `Tile with id ${alert.tileId} not found in dashboard ${dashboard.name}`,
      );
    }
    const formattedValue = formatValueToMatchThreshold(value, alert.threshold);
    const baseTitle = template
      ? handlebars.compile(template)(view)
      : `Alert for "${tile.config.name}" in "${dashboard.name}" - ${formattedValue} ${
          doesExceedThreshold(alert, value)
            ? describeThresholdViolation(alert.thresholdType)
            : describeThresholdResolution(alert.thresholdType)
        } ${describeThreshold(alert)}`;
    return `${emoji}${baseTitle}`;
  } else if (alert.source === AlertSource.INLINE) {
    const formattedValue = formatValueToMatchThreshold(value, alert.threshold);
    // Inline alerts have no saved search/tile to name them; the alert's `name`
    // doubles as the title template, so the default falls back to the chart
    // config's name.
    const baseTitle = template
      ? handlebars.compile(template)(view)
      : `Alert for "${alert.chartConfig?.name ?? 'chart'}" - ${formattedValue} ${
          doesExceedThreshold(alert, value)
            ? describeThresholdViolation(alert.thresholdType)
            : describeThresholdResolution(alert.thresholdType)
        } ${describeThreshold(alert)}`;
    return `${emoji}${baseTitle}`;
  }

  throw new Error(`Unsupported alert source: ${alert.source}`);
};

export const translateExternalActionsToInternal = (template: string) => {
  // ex: @webhook-1234_5678 -> "{{NOTIFY_FN_NAME channel="webhook" id="1234_5678}}"
  // ex: @webhook-{{attributes.webhookId}} -> "{{NOTIFY_FN_NAME channel="webhook" id="{{attributes.webhookId}}"}}"
  return template.replace(/(?:^|\s)@([a-zA-Z0-9.{}@_-]+)/g, (match, input) => {
    const prefix = match.startsWith(' ') ? ' ' : '';
    const [channel, ...ids] = input.split('-');
    const id = ids.join('-');
    // TODO: sanity check ??
    return `${prefix}{{${NOTIFY_FN_NAME} channel="${channel}" id="${id}"}}`;
  });
};

const findWebhookByName = (
  channelIdOrNamePrefix: string,
  teamWebhooksById: Map<string, IWebhook>,
) => {
  return [...teamWebhooksById.values()].find(w =>
    w.name.startsWith(channelIdOrNamePrefix),
  );
};

const getPopulatedChannel = (
  channelType: AlertChannelType,
  channelIdOrNamePrefix: string,
  teamWebhooksById: Map<string, IWebhook>,
): PopulatedAlertChannel => {
  switch (channelType) {
    case 'webhook': {
      const webhook =
        teamWebhooksById.get(channelIdOrNamePrefix) ??
        findWebhookByName(channelIdOrNamePrefix, teamWebhooksById);

      if (!webhook) {
        logger.error(
          {
            webhookId: channelIdOrNamePrefix,
          },
          'webhook not found',
        );
        throw new WebhookNotFoundError(
          `Webhook not found. The webhook may have been deleted — update the alert's notification channel.`,
        );
      }
      return { type: 'webhook', channel: webhook };
    }
    default: {
      logger.error({ channelType }, 'Unsupported alert channel type');
      throw new Error('Unsupported alert destination');
    }
  }
};

/**
 * A notification target that did not end up delivered: it never reached the
 * dispatcher (unresolvable mention/webhook, the per-event cap), or it did
 * reach the dispatcher and `dispatch()` rejected. The inline dispatcher
 * resolves after delivery, so a real send failure rejects and is caught below
 * — a queued dispatcher instead resolves after enqueue and reports delivery
 * outcomes through its own logs/metrics, so this array simply won't see them.
 */
export type NotificationFailure = {
  /** The webhook id/name prefix, or the raw @mention, that failed. */
  target: string;
  /** The channel type the target belongs to, or 'unknown' when it couldn't be determined (e.g. an unparseable @mention). */
  type: AlertChannelType | 'unknown';
  error: unknown;
};

// PopulatedAlertChannel only has a `webhook` variant in this repo, but a
// downstream build adds more (e.g. `email`) without a `channel` field at all.
// Narrowing here — rather than assuming `.channel` exists — keeps this
// mechanical for that merge instead of a judgement call, and keeps an error
// handler from throwing on an unrecognized channel type.
const channelKey = (c: PopulatedAlertChannel) =>
  c.type === 'webhook' ? c.channel._id.toString() : JSON.stringify(c);
const channelLabel = (c: PopulatedAlertChannel) =>
  c.type === 'webhook' ? c.channel.name : c.type;

/**
 * One dispatch's wall time. Emitted per target per event, so a grouped alert
 * produces one of these per (group, target); the caller aggregates.
 */
export type NotificationTiming = {
  /** Stable identity for aggregation across events — the webhook id. */
  key: string;
  /** Display label: the webhook's name. */
  target: string;
  durationMs: number;
  ok: boolean;
};

export type RenderedAlert = {
  /** The rendered message body, as delivered to every target. */
  body: string;
  /** One entry per target that did not end up delivered — see NotificationFailure. */
  failures: NotificationFailure[];
  /**
   * One entry per target that reached the dispatcher, delivered or not.
   * Targets that failed before dispatch have no timing — there was nothing to
   * time — so this is not the complement of `failures`.
   */
  timings: NotificationTiming[];
};

// this method will build the body of the alert message and will be used to send the alert to the channel
export const renderAlertTemplate = async ({
  alertProvider,
  clickhouseClient,
  metadata,
  state,
  template,
  title,
  view: inputView,
  teamId,
  teamWebhooksById,
  dispatcher = inlineNotificationDispatcher,
}: {
  alertProvider: AlertProvider;
  clickhouseClient: ClickhouseClient;
  metadata: Metadata;
  state: AlertState;
  template?: string | null;
  title: string;
  view: AlertMessageTemplateDefaultView;
  teamId: string;
  teamWebhooksById: Map<string, IWebhook>;
  dispatcher?: NotificationDispatcher;
}): Promise<RenderedAlert> => {
  // Internal mutable view with __hdx_query_results__ populated on the
  // saved-search path. Untrusted values must flow through the view so
  // Handlebars treats them as literal data, never as template syntax.
  const view: AlertMessageTemplateDefaultView & {
    __hdx_query_results__: string;
  } = {
    ...inputView,
    __hdx_query_results__: '',
  };

  const {
    alert,
    dashboard,
    endTime,
    group,
    savedSearch,
    source,
    startTime,
    value,
  } = view;

  // Only ad hoc `@mentions` written into the message body go through the
  // template. The alert's configured channels are queued directly below.
  const targetTemplate = translateExternalActionsToInternal(template ?? '');

  const isMatchFn = function (shouldRender: boolean) {
    return function (
      targetKey: string,
      targetValue: string,
      options: HelperOptions,
    ) {
      if (_.has(view, targetKey) && _.get(view, targetKey) === targetValue) {
        if (shouldRender) {
          return options.fn(this);
        } else {
          options.fn(this);
        }
      }
    };
  };
  const _hb = createHandlebarsWithHelpers();
  _hb.registerHelper(NOTIFY_FN_NAME, () => null);
  _hb.registerHelper(IS_MATCH_FN_NAME, isMatchFn(true));
  const hb = PromisedHandlebars(Handlebars);

  // Rendering collects the notification jobs; dispatch happens once afterwards
  // so every target goes out concurrently instead of serially mid-render.
  const jobs: NotificationJob[] = [];
  const failures: NotificationFailure[] = [];
  // Webhook ids already queued this event, so a target configured as a channel
  // and also named by an @mention is only notified once.
  const queuedWebhookIds = new Set<string>();

  // A target that failed before dispatch still needs to surface as its own
  // result, so the alert reports which channel missed out.
  const recordPreFailure = (
    target: string,
    type: AlertChannelType | 'unknown',
    error: unknown,
  ) => {
    failures.push({ target, type, error });
  };

  /**
   * Queue one resolved target. Returns false when it was already queued — a
   * configured channel and an `@mention` can name the same destination, and
   * notifying it twice is not the intent.
   */
  const queueChannel = (
    channel: PopulatedAlertChannel,
    renderedBody: string,
  ) => {
    const webhookId = channelKey(channel);
    if (queuedWebhookIds.has(webhookId)) {
      return false;
    }
    queuedWebhookIds.add(webhookId);

    const eventId = objectHash({
      alertId: alert.id,
      channel: {
        type: channel.type,
        id: channel.channel._id.toString(),
      },
      // Explicitly track if this is a grouped alert
      isGrouped: view.isGroupedAlert,
      ...(view.isGroupedAlert && group ? { groupId: group } : {}),
    });

    jobs.push({
      eventId,
      alertId: alert.id,
      teamId,
      group,
      populatedChannel: channel,
      message: {
        hdxLink: buildAlertMessageTemplateHdxLink(alertProvider, view),
        title,
        body: renderedBody,
        state,
        startTime: view.startTime.getTime(),
        endTime: view.endTime.getTime(),
        eventId,
        // Enriched fields, exposed to Generic/incident.io body templates.
        alertId: alert.id ?? '',
        status: ALERT_STATUS_BY_STATE[state],
        alertType: alert.source ? ALERT_TYPE_BY_SOURCE[alert.source] : '',
        comparator: COMPARATOR_BY_THRESHOLD_TYPE[alert.thresholdType],
        threshold: alert.threshold,
        // Gated on the comparator, not just read off the alert: nothing clears
        // a persisted `thresholdMax` when an alert is switched off a range
        // comparator, and a stale bound would advertise a range that no longer
        // fires.
        thresholdMax: isRangeThresholdType(alert.thresholdType)
          ? alert.thresholdMax
          : undefined,
        value,
        groupKey: group ?? '',
        sourceQuery: describeSourceQuery(alert, savedSearch),
        teamId,
        note: alert.note ?? '',
      },
    });
    return true;
  };

  /**
   * Expand one configured channel into the targets it delivers to, resolved
   * straight from the alert rather than round-tripped through an
   * `@webhook-<id>` mention string. The mention carries only `type` and an id,
   * so every other field on the channel was lost before delivery.
   */
  const resolveConfiguredChannel = (
    channel: AlertChannel,
  ): PopulatedAlertChannel[] => {
    if (channel.type !== 'webhook') {
      return [];
    }
    const webhook = teamWebhooksById.get(channel.webhookId);
    if (!webhook) {
      logger.error(
        { alertId: alert.id, webhookId: channel.webhookId },
        'webhook not found',
      );
      recordPreFailure(
        channel.webhookId,
        'webhook',
        new WebhookNotFoundError(
          `Webhook not found. The webhook may have been deleted — update the alert's notification channel.`,
        ),
      );
      return [];
    }
    return [{ type: 'webhook', channel: webhook }];
  };

  const registerHelpers = (rawTemplateBody: string) => {
    hb.registerHelper(IS_MATCH_FN_NAME, isMatchFn(false));

    // Register a custom helper which sends notifications to the specified channel
    // Usage: {{NOTIFY_FN_NAME channel="webhook" id="1234_5678"}}
    hb.registerHelper(NOTIFY_FN_NAME, async (options: unknown) => {
      // Any `@word` in the message body is rewritten into this helper, so an
      // ordinary mention like "@here" arrives with an unsupported channel type.
      // Parsing inside the guard keeps that from rejecting the whole render and
      // dropping every already-collected job.
      const parsed = zNotifyFnParams.safeParse(options);
      if (!parsed.success) {
        const mention =
          typeof options === 'object' &&
          options !== null &&
          'hash' in options &&
          typeof (options as { hash?: unknown }).hash === 'object'
            ? JSON.stringify((options as { hash: unknown }).hash)
            : 'unknown';
        logger.warn(
          { alertId: alert.id, mention },
          'Unsupported notification mention in alert message; skipping it',
        );
        recordPreFailure(
          mention,
          'unknown',
          new UnsupportedMentionError(
            'Alert message contains a mention that is not a webhook channel.',
          ),
        );
        return;
      }
      const { channel: channelType, id: idTemplate } = parsed.data.hash;

      // The id field can also be a template itself, e.g. id="{{attributes.webhookId}}", so it must be compiled and rendered
      // The id might also be the prefix of the webhook name.
      const renderedIdOrNamePrefix = _hb.compile(idTemplate)(view);

      // render body template
      const renderedBody = _hb.compile(rawTemplateBody)(view);

      let channel: PopulatedAlertChannel;
      try {
        channel = getPopulatedChannel(
          channelType,
          renderedIdOrNamePrefix,
          teamWebhooksById,
        );
      } catch (e) {
        // A missing webhook must not abort the render: the other channels
        // still fire, and this one is reported per-target.
        recordPreFailure(renderedIdOrNamePrefix, channelType, e);
        return;
      }

      // Resolve and dedupe before the cap check: a channel and an @mention can
      // name the same target by id and by name prefix, and a repeat of an
      // already-queued target is a no-op, not a target the cap turned away.
      const webhookId = channelKey(channel);
      if (queuedWebhookIds.has(webhookId)) {
        return;
      }

      if (jobs.length >= MAX_NOTIFICATIONS_PER_EVENT) {
        logger.warn(
          { alertId: alert.id, cap: MAX_NOTIFICATIONS_PER_EVENT },
          'Notification cap reached for this alert event; skipping channel',
        );
        notificationCapExceededCounter.add(1, { channel_type: channelType });
        // Record it as a per-target failure too. A skipped channel that only
        // shows up in a log line and a metric looks like a healthy alert to the
        // operator, who never learns some targets were never notified.
        recordPreFailure(
          renderedIdOrNamePrefix,
          channelType,
          new NotificationCapExceededError(MAX_NOTIFICATIONS_PER_EVENT),
        );
        return;
      }
      queueChannel(channel, renderedBody);
    });
  };

  const timeRangeMessage = `Time Range (UTC): [${formatDate(view.startTime, {
    isUTC: true,
  })} - ${formatDate(view.endTime, {
    isUTC: true,
  })})`;
  let rawTemplateBody;

  // For resolved alerts, use a simple message instead of fetching data
  if (isAlertResolved(state)) {
    rawTemplateBody = `{{#if group}}Group: "{{{group}}}" - {{/if}}The alert has been resolved.\n${timeRangeMessage}
${targetTemplate}`;
  }
  // TODO: support advanced routing with template engine
  // users should be able to use '@' syntax to trigger alerts
  else if (alert.source === AlertSource.SAVED_SEARCH) {
    if (savedSearch == null) {
      throw new Error(`Source is ${alert.source} but savedSearch is null`);
    }
    if (source == null) {
      throw new Error(`Source ID is ${alert.source} but source is null`);
    }
    if (source.kind !== SourceKind.Log && source.kind !== SourceKind.Trace) {
      throw new Error(
        `Expecting SourceKind 'trace' or 'log', got ${source.kind}`,
      );
    }
    // TODO: show group + total count for group-by alerts
    // fetch sample logs
    const resolvedSelect =
      savedSearch.select || source.defaultTableSelectExpression || '';
    const chartConfig: ChartConfigWithOptDateRange = {
      connection: '', // no need for the connection id since clickhouse client is already initialized
      displayType: DisplayType.Search,
      dateRange: [startTime, endTime],
      from: source.from,
      select: resolvedSelect,
      where: savedSearch.where,
      whereLanguage: savedSearch.whereLanguage,
      implicitColumnExpression: source.implicitColumnExpression,
      useTextIndexForImplicitColumn: source.useTextIndexForImplicitColumn,
      ...pickSampleWeightExpressionProps(source),
      timestampValueExpression: source.timestampValueExpression,
      orderBy: savedSearch.orderBy,
      limit: {
        limit: 5,
        offset: 0,
      },
    };

    let truncatedResults = '';
    try {
      const aliasWith = await computeAliasWithClauses(
        savedSearch,
        source,
        metadata,
      );
      if (aliasWith) {
        chartConfig.with = aliasWith;
      }
      const query = await renderChartConfig(
        chartConfig,
        metadata,
        source.querySettings,
      );
      const raw = await clickhouseClient
        .query<'CSV'>({
          query: query.sql,
          query_params: query.params,
          format: 'CSV',
        })
        .then(res => res.text());

      const lines = raw.split('\n');

      truncatedResults = truncateString(
        lines.map(line => truncateString(line, MAX_MESSAGE_LENGTH)).join('\n'),
        2500,
      );
    } catch (e) {
      logger.error(
        {
          savedSearchId: savedSearch.id,
          chartConfig,
          error: serializeError(e),
        },
        'Failed to fetch sample logs',
      );
    }

    // Pass query results through the view so Handlebars syntax in log lines
    // is treated as literal text rather than parsed as template source.
    view.__hdx_query_results__ = truncatedResults;

    rawTemplateBody = `{{#if group}}Group: "{{{group}}}"{{/if}}
${value} lines found, which ${describeThresholdViolation(alert.thresholdType)} the threshold of ${describeThreshold(alert)} lines\n${timeRangeMessage}
${targetTemplate}
\`\`\`
{{{__hdx_query_results__}}}
\`\`\``;
  } else if (
    alert.source === AlertSource.TILE ||
    alert.source === AlertSource.INLINE
  ) {
    if (alert.source === AlertSource.TILE && dashboard == null) {
      throw new Error(`Source is ${alert.source} but dashboard is null`);
    }
    const formattedValue = formatValueToMatchThreshold(value, alert.threshold);
    rawTemplateBody = `{{#if group}}Group: "{{{group}}}"{{/if}}
${formattedValue} ${
      doesExceedThreshold(alert, value)
        ? describeThresholdViolation(alert.thresholdType)
        : describeThresholdResolution(alert.thresholdType)
    } ${describeThreshold(alert)}\n${timeRangeMessage}
${targetTemplate}`;
  }

  // render the template
  if (rawTemplateBody) {
    // Queue the configured channels first, and without the per-event cap:
    // `channels` is already bounded by MAX_ALERT_CHANNELS, so letting ad hoc
    // mentions in the message body crowd out an alert's own targets would be
    // backwards.
    const configuredBody = _hb.compile(rawTemplateBody)(view);
    for (const configured of getAlertChannels(alert)) {
      for (const channel of resolveConfiguredChannel(configured)) {
        queueChannel(channel, configuredBody);
      }
    }

    registerHelpers(rawTemplateBody);
    const compiledTemplate = hb.compile(rawTemplateBody);
    const body = await compiledTemplate(view);

    // Dispatch every surviving channel concurrently, once the render (and
    // therefore the message body) is complete. Each dispatch is isolated in
    // its own try/catch so one failing channel can't stop the others.
    //
    // The inline dispatcher resolves *after* delivery, so a real send failure
    // rejects here and is recorded exactly like a pre-dispatch failure — this
    // preserves WEBHOOK_ERROR reporting for the default (only) dispatcher. A
    // queued dispatcher resolves after enqueue and never rejects here; it
    // reports delivery outcomes through its own logs/metrics instead (see
    // agent_docs/observability.md).
    const timings: NotificationTiming[] = [];
    await Promise.all(
      jobs.map(async job => {
        // Per-job, not around the Promise.all: the whole point is attributing
        // the total to a target, and the dispatches overlap.
        const startedAt = performance.now();
        let ok = true;
        try {
          await dispatcher.dispatch(job);
        } catch (e) {
          ok = false;
          logger.error(
            {
              alertId: alert.id,
              webhookId: channelKey(job.populatedChannel),
              error: serializeError(e),
            },
            'Failed to deliver alert notification',
          );
          failures.push({
            target: channelLabel(job.populatedChannel),
            type: job.populatedChannel.type,
            error: e,
          });
        } finally {
          timings.push({
            key: channelKey(job.populatedChannel),
            target: channelLabel(job.populatedChannel),
            durationMs: Math.round(performance.now() - startedAt),
            ok,
          });
        }
      }),
    );

    return { body, failures, timings };
  }

  throw new Error(`Unsupported alert source: ${alert.source}`);
};
