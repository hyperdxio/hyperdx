import * as React from 'react';
import { isRangeThresholdType } from '@hyperdx/common-utils/dist/types';
import { Group } from '@mantine/core';

import type { AlertsPageItem } from '@/types';
import { TILE_ALERT_THRESHOLD_TYPE_OPTIONS } from '@/utils/alerts';
import { getWebhookChannelIcon } from '@/utils/webhookIcons';

type AlertPropertiesSummaryProps = {
  alert: AlertsPageItem;
  /**
   * Include the evaluation schedule (interval and, when configured,
   * consecutive-window count). On by the detail page; the alerts-page rows
   * keep the shorter line.
   */
  showSchedule?: boolean;
  /**
   * Display name of the notification webhook (the alert only stores its id).
   * The detail page resolves and passes it; the alerts-page rows keep the
   * generic "Webhook" label.
   */
  webhookName?: string;
};

/**
 * One-line alert metadata summary: threshold condition, optional evaluation
 * schedule, notification channel, and creator. Shared between the alerts
 * page rows and the alert detail page header.
 */
export function AlertPropertiesSummary({
  alert,
  showSchedule = false,
  webhookName,
}: AlertPropertiesSummaryProps) {
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
      {showSchedule && (
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
      <Group gap={5}>
        Notify via {getWebhookChannelIcon(alert.channel.type)}{' '}
        {webhookName ?? 'Webhook'}
      </Group>
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
