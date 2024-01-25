import { sub } from 'date-fns';
import { Form, FormSelectProps } from 'react-bootstrap';

import api from './api';
import { Granularity } from './ChartUtils';
import type { AlertChannelType, AlertInterval } from './types';

export function intervalToGranularity(interval: AlertInterval) {
  if (interval === '1m') return Granularity.OneMinute;
  if (interval === '5m') return Granularity.FiveMinute;
  if (interval === '15m') return Granularity.FifteenMinute;
  if (interval === '30m') return Granularity.ThirtyMinute;
  if (interval === '1h') return Granularity.OneHour;
  if (interval === '6h') return Granularity.SixHour;
  if (interval === '12h') return Granularity.TwelveHour;
  if (interval === '1d') return Granularity.OneDay;
  return Granularity.OneDay;
}

export function intervalToDateRange(interval: AlertInterval): [Date, Date] {
  const now = new Date();
  if (interval === '1m') return [sub(now, { minutes: 15 }), now];
  if (interval === '5m') return [sub(now, { hours: 1 }), now];
  if (interval === '15m') return [sub(now, { hours: 4 }), now];
  if (interval === '30m') return [sub(now, { hours: 8 }), now];
  if (interval === '1h') return [sub(now, { hours: 16 }), now];
  if (interval === '6h') return [sub(now, { days: 4 }), now];
  if (interval === '12h') return [sub(now, { days: 7 }), now];
  if (interval === '1d') return [sub(now, { days: 7 }), now];
  return [now, now];
}

export const ALERT_INTERVAL_OPTIONS: Record<AlertInterval, string> = {
  '1m': '1 minute',
  '5m': '5 minute',
  '15m': '15 minute',
  '30m': '30 minute',
  '1h': '1 hour',
  '6h': '6 hour',
  '12h': '12 hour',
  '1d': '1 day',
};

export const ALERT_CHANNEL_OPTIONS: Record<AlertChannelType, string> = {
  webhook: 'Slack Webhook',
};

export const SlackChannelForm = ({
  webhookSelectProps,
}: {
  webhookSelectProps: FormSelectProps;
}) => {
  const { data: slackWebhooks } = api.useWebhooks('slack');

  const hasSlackWebhooks =
    Array.isArray(slackWebhooks?.data) && slackWebhooks.data.length > 0;

  return (
    <>
      <div className="mt-3">
        <Form.Label className="text-muted">Slack Webhook</Form.Label>
        <Form.Select
          className="bg-black border-0 mb-1 px-3"
          required
          id="webhookId"
          size="sm"
          {...webhookSelectProps}
        >
          {/* Ensure user selects a slack webhook before submitting form */}
          <option value="" disabled selected>
            {hasSlackWebhooks
              ? 'Select a Slack Webhook'
              : 'No Slack Webhooks available'}
          </option>
          {slackWebhooks?.data.map((sw: any) => (
            <option key={sw._id} value={sw._id}>
              {sw.name}
            </option>
          ))}
        </Form.Select>
      </div>

      <div className="mb-2">
        <a
          href="/team"
          target="_blank"
          className="text-muted-hover d-flex align-items-center gap-1 fs-8"
        >
          <i className="bi bi-plus fs-5" />
          Add New Slack Incoming Webhook
        </a>
      </div>
    </>
  );
};
