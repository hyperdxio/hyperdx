import * as React from 'react';
import produce from 'immer';
import { omit } from 'lodash';
import { Form } from 'react-bootstrap';
import { Tooltip } from '@mantine/core';

import {
  ALERT_CHANNEL_OPTIONS,
  ALERT_INTERVAL_OPTIONS,
  SlackChannelForm,
} from './Alert';
import type { Alert } from './types';
import { NumberFormat } from './types';
import { formatNumber } from './utils';

// Don't allow 1 minute alerts for charts
const CHART_ALERT_INTERVAL_OPTIONS = omit(ALERT_INTERVAL_OPTIONS, '1m');

type ChartAlertFormProps = {
  alert: Alert;
  setAlert: (alert?: Alert) => void;
  numberFormat?: NumberFormat;
};

export default function EditChartFormAlerts({
  alert,
  setAlert,
  numberFormat,
}: ChartAlertFormProps) {
  return (
    <>
      <div className="d-flex align-items-center gap-3 flex-wrap">
        <span>
          Alert when the value
          <Tooltip label="Raw value before applying number format">
            <i className="bi bi-question-circle ms-1 text-slate-300" />
          </Tooltip>
        </span>
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
        <div style={{ marginBottom: -20 }}>
          <Form.Control
            style={{ width: 100 }}
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
          <div
            className="text-slate-300 fs-8"
            style={{
              height: 20,
            }}
          >
            {numberFormat && alert?.threshold > 0 && (
              <>
                {formatNumber(alert.threshold, numberFormat)}
                <Tooltip label="Formatted value">
                  <i className="bi bi-question-circle ms-1 text-slate-300" />
                </Tooltip>
              </>
            )}
          </div>
        </div>
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
          <option value="" disabled>
            Select interval
          </option>
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
