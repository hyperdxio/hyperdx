import * as React from 'react';
import { WebhookService } from '@hyperdx/common-utils/dist/types';
import { Badge, Group, Text } from '@mantine/core';

import api from '@/api';
import { AlertPropertiesSummary } from '@/components/alerts/AlertPropertiesSummary';
import type { AlertsPageItem } from '@/types';
import { FormatTime } from '@/useFormatTime';
import { isAlertSilenceExpired } from '@/utils/alerts';

function PropertyRow({
  label,
  children,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Group gap="sm" align="baseline" wrap="nowrap" data-testid={testId}>
      <Text size="xs" c="dimmed" miw={110} style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Text size="xs" component="div" style={{ minWidth: 0 }}>
        {children}
      </Text>
    </Group>
  );
}

/**
 * Full alert metadata block for the alert detail page: the shared one-line
 * summary (threshold, schedule, channel, creator) plus every other persisted
 * property — name, message template, group-by, schedule anchor/offset,
 * acknowledgement, tags, and created/updated timestamps. Rows render only
 * when the field is set.
 */
export function AlertDetailProperties({ alert }: { alert: AlertsPageItem }) {
  // Resolve the notification webhook's display name (the alert only stores
  // its id). Falls back to the generic "Webhook" label while loading or if
  // the webhook has been deleted.
  const { data: webhooks } = api.useWebhooks([
    WebhookService.Slack,
    WebhookService.Generic,
    WebhookService.IncidentIO,
  ]);
  const webhookName = React.useMemo(() => {
    if (!alert.channel.webhookId) {
      return undefined;
    }
    return webhooks?.data?.find(
      (w: { _id: string; name: string }) => w._id === alert.channel.webhookId,
    )?.name;
  }, [webhooks, alert.channel.webhookId]);

  const tags = alert.dashboard?.tags ?? alert.savedSearch?.tags ?? [];
  const hasScheduleAnchor = alert.scheduleStartAt != null;
  const hasScheduleOffset =
    alert.scheduleOffsetMinutes != null && alert.scheduleOffsetMinutes > 0;

  return (
    <div data-testid="alert-detail-properties">
      <AlertPropertiesSummary
        alert={alert}
        showSchedule
        webhookName={webhookName}
      />
      <div className="d-flex flex-column gap-1 mt-2">
        {alert.name && (
          <PropertyRow label="Name" testId="alert-property-name">
            {alert.name}
          </PropertyRow>
        )}
        {alert.message && (
          <PropertyRow label="Message template" testId="alert-property-message">
            {alert.message}
          </PropertyRow>
        )}
        {alert.groupBy && (
          <PropertyRow label="Grouped by" testId="alert-property-group-by">
            <Text size="xs" ff="monospace" component="span">
              {alert.groupBy}
            </Text>
          </PropertyRow>
        )}
        {(hasScheduleAnchor || hasScheduleOffset) && (
          <PropertyRow label="Schedule" testId="alert-property-schedule">
            {hasScheduleAnchor ? (
              <>
                Windows anchored at{' '}
                <FormatTime value={alert.scheduleStartAt!} format="withYear" />
              </>
            ) : (
              <>
                Offset {alert.scheduleOffsetMinutes}m into each evaluation
                window
              </>
            )}
          </PropertyRow>
        )}
        {alert.silenced && (
          <PropertyRow label="Acknowledged" testId="alert-property-silenced">
            {alert.silenced.by ? <>by {alert.silenced.by} · </> : null}
            {isAlertSilenceExpired(alert.silenced) ? (
              <>
                expired <FormatTime value={alert.silenced.until} />
              </>
            ) : (
              <>
                silenced until <FormatTime value={alert.silenced.until} />
              </>
            )}
          </PropertyRow>
        )}
        {tags.length > 0 && (
          <PropertyRow label="Tags" testId="alert-property-tags">
            <Group gap={4}>
              {tags.map(tag => (
                <Badge key={tag} variant="light" color="gray" size="xs">
                  {tag}
                </Badge>
              ))}
            </Group>
          </PropertyRow>
        )}
        <PropertyRow label="Created" testId="alert-property-created">
          <Text size="xs" c="dimmed" component="span">
            <FormatTime value={alert.createdAt} format="withYear" />
            {alert.updatedAt && alert.updatedAt !== alert.createdAt && (
              <>
                {' '}
                · Updated{' '}
                <FormatTime value={alert.updatedAt} format="withYear" />
              </>
            )}
          </Text>
        </PropertyRow>
      </div>
    </div>
  );
}
