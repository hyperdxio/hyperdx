import * as React from 'react';
import {
  isRangeThresholdType,
  WebhookService,
} from '@hyperdx/common-utils/dist/types';
import { Group, Tooltip, UnstyledButton, VisuallyHidden } from '@mantine/core';

import api from '@/api';
import type { AlertsPageItem } from '@/types';
import {
  TILE_ALERT_THRESHOLD_TYPE_OPTIONS,
  toAlertChannels,
} from '@/utils/alerts';
import { getWebhookChannelIcon } from '@/utils/webhookIcons';

/**
 * Targets listed inline before the rest collapse into a "+N more" tooltip.
 * An alert can carry up to MAX_ALERT_CHANNELS, which would push the creator
 * and threshold off the end of the alerts-page rows.
 */
const MAX_INLINE_TARGETS = 2;

type AlertPropertiesSummaryProps = {
  alert: AlertsPageItem;
  /**
   * Which surface is rendering. `detail` names the targets and adds the
   * evaluation schedule; `row` shows target icons only, with the names on
   * hover, so a multi-target alert doesn't wrap the line.
   */
  variant?: 'row' | 'detail';
};

type NotificationTarget = {
  key: string;
  name: string;
  /** Webhook service, for the icon. Undefined until the webhooks load. */
  service?: WebhookService;
};

/**
 * Resolve an alert's notification channels to display targets. The alert only
 * stores webhook ids, so names and service icons come from the team's webhooks.
 * The query key is shared, so every row on the alerts page reads one fetch.
 */
function useNotificationTargets(alert: AlertsPageItem): NotificationTarget[] {
  const { data: webhooks } = api.useWebhooks([
    WebhookService.Slack,
    WebhookService.Generic,
    WebhookService.IncidentIO,
  ]);

  return React.useMemo(() => {
    return toAlertChannels(alert).map((channel, index) => {
      const webhook = channel.webhookId
        ? webhooks?.data?.find(w => w._id === channel.webhookId)
        : undefined;
      return {
        // Index-qualified: rows written before the API rejected duplicate
        // channels can repeat a webhookId.
        key: `${channel.webhookId || channel.type}-${index}`,
        // Falls back to the generic label while the webhooks load, and for
        // webhooks that have since been deleted.
        name: webhook?.name ?? 'Webhook',
        service: webhook?.service,
      };
    });
  }, [alert, webhooks]);
}

/**
 * Notification targets. Named and comma-separated on the detail page, with
 * the overflow behind a tooltip; icons only on the alerts-page rows, where
 * spelling out up to ten names wrapped the line into an unreadable block.
 */
function NotificationTargets({
  alert,
  showNames,
}: {
  alert: AlertsPageItem;
  showNames: boolean;
}) {
  const targets = useNotificationTargets(alert);
  const allNames = targets.map(target => target.name).join(', ');

  if (!showNames) {
    return (
      <Tooltip label={allNames} multiline maw={320} withArrow color="dark">
        <Group gap={4} wrap="nowrap" data-testid="alert-notification-targets">
          Notify via
          {targets.map(target => (
            <React.Fragment key={target.key}>
              {getWebhookChannelIcon(target.service)}
            </React.Fragment>
          ))}
          {/* The names are otherwise hover-only. An aria-label on the
              wrapper would sit on a role-less div, which isn't reliably
              exposed, so put the text in the tree instead. */}
          <VisuallyHidden>{allNames}</VisuallyHidden>
        </Group>
      </Tooltip>
    );
  }

  const inline = targets.slice(0, MAX_INLINE_TARGETS);
  const overflow = targets.length - inline.length;
  const overflowNames = targets
    .slice(MAX_INLINE_TARGETS)
    .map(target => target.name)
    .join(', ');

  return (
    <Group gap={5} wrap="nowrap" data-testid="alert-notification-targets">
      Notify via
      {inline.map((target, index) => (
        <React.Fragment key={target.key}>
          {getWebhookChannelIcon(target.service)}
          <span>
            {index < inline.length - 1 || overflow > 0
              ? `${target.name},`
              : target.name}
          </span>
        </React.Fragment>
      ))}
      {overflow > 0 && (
        <Tooltip
          label={allNames}
          multiline
          maw={320}
          withArrow
          color="dark"
          // Mantine leaves focus off by default, so a keyboard user could tab
          // to the trigger and still never see the names.
          events={{ hover: true, focus: true, touch: true }}
        >
          {/* A button, not a span: the overflowed names exist nowhere else, so
              the trigger has to be reachable by keyboard. The accessible name
              carries them outright, for anyone who can't see a tooltip. */}
          <UnstyledButton
            fz="inherit"
            c="inherit"
            td="underline"
            aria-label={`${overflow} more: ${overflowNames}`}
          >
            +{overflow} more
          </UnstyledButton>
        </Tooltip>
      )}
    </Group>
  );
}

/**
 * One-line alert metadata summary: threshold condition, optional evaluation
 * schedule, notification targets, and creator. Shared between the alerts
 * page rows and the alert detail page header.
 */
export function AlertPropertiesSummary({
  alert,
  variant = 'row',
}: AlertPropertiesSummaryProps) {
  const isDetail = variant === 'detail';
  const thresholdLabel =
    TILE_ALERT_THRESHOLD_TYPE_OPTIONS[alert.thresholdType] ??
    alert.thresholdType;

  return (
    <div className="fs-8 d-flex gap-2 align-items-center">
      <span>
        If value {thresholdLabel}{' '}
        <span className="fw-bold">{alert.threshold}</span>
        {isRangeThresholdType(alert.thresholdType) && (
          <>
            {' '}
            and <span className="fw-bold">{alert.thresholdMax ?? '-'}</span>
          </>
        )}
      </span>
      {isDetail && (
        <>
          <span>&middot;</span>
          <span>Evaluates every {alert.interval}</span>
          {alert.numConsecutiveWindows != null &&
            alert.numConsecutiveWindows > 1 && (
              <>
                <span>&middot;</span>
                <span>
                  Fires after {alert.numConsecutiveWindows} consecutive windows
                </span>
              </>
            )}
        </>
      )}
      <span>&middot;</span>
      <NotificationTargets alert={alert} showNames={isDetail} />
      {alert.createdBy && (
        <>
          <span>&middot;</span>
          <span>
            Created by {alert.createdBy.name || alert.createdBy.email}
          </span>
        </>
      )}
    </div>
  );
}
