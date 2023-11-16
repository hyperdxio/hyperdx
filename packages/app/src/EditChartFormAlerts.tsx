import * as React from 'react';
import { Form } from 'react-bootstrap';
import { omit } from 'lodash';
import produce from 'immer';
import type { Alert } from './types';

import {
  ALERT_INTERVAL_OPTIONS,
  ALERT_CHANNEL_OPTIONS,
  SlackChannelForm,
} from './Alert';

// Don't allow 1 minute alerts for charts
const CHART_ALERT_INTERVAL_OPTIONS = omit(ALERT_INTERVAL_OPTIONS, '1m');

type ChartAlertFormProps = {
  alert: Alert;
  setAlert: (alert?: Alert) => void;
};

export default function EditChartFormAlerts({
  alert,
  setAlert,
}: ChartAlertFormProps) {
  return (
    <>
      <div className="d-flex align-items-center gap-3">
        Alert when the value
        <Form.Select
          id="type"
          size="sm"
          style={{
            width: 140,
          }}
          value={alert?.type}
          onChange={e => {
            setAlert(
              produce(alert, draft => {
                draft.type = e.target.value as 'presence' | 'absence';
              }),
            );
          }}
        >
          <option key="presence" value="presence">
            exceeds
          </option>
          <option key="absence" value="absence">
            falls below
          </option>
        </Form.Select>
        <Form.Control
          style={{ width: 70 }}
          type="number"
          required
          id="threshold"
          size="sm"
          defaultValue={1}
          value={alert?.threshold}
          onChange={e => {
            setAlert(
              produce(alert, draft => {
                draft.threshold = parseFloat(e.target.value);
              }),
            );
          }}
        />
        over
        <Form.Select
          id="interval"
          size="sm"
          style={{
            width: 140,
          }}
          value={alert?.interval}
          onChange={e => {
            setAlert(
              produce(alert, draft => {
                draft.interval = e.target
                  .value as keyof typeof ALERT_INTERVAL_OPTIONS;
              }),
            );
          }}
        >
          {Object.entries(CHART_ALERT_INTERVAL_OPTIONS).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </Form.Select>
        window via
        <Form.Select
          id="channel"
          size="sm"
          style={{ width: 200 }}
          value={alert?.channel?.type}
          onChange={e => {
            setAlert(
              produce(alert, draft => {
                draft.channel = {
                  type: e.target.value as keyof typeof ALERT_CHANNEL_OPTIONS,
                };
              }),
            );
          }}
        >
          {Object.entries(ALERT_CHANNEL_OPTIONS).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </Form.Select>
      </div>
      <div className="mt-3">
        {alert?.channel?.type === 'webhook' && (
          <SlackChannelForm
            webhookSelectProps={{
              value: alert?.channel?.webhookId || '',
              onChange: e => {
                setAlert(
                  produce(alert, draft => {
                    draft.channel = {
                      type: 'webhook',
                      webhookId: e.target.value,
                    };
                  }),
                );
              },
            }}
          />
        )}
      </div>
    </>
  );
}
