import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { Button, Form } from 'react-bootstrap';

import api from './api';
import AppNav from './AppNav';

// stolen directly from the api alert model for now
export type AlertType = 'presence' | 'absence';

export enum AlertState {
  ALERT = 'ALERT',
  DISABLED = 'DISABLED',
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA',
  OK = 'OK',
}

// follow 'ms' pkg formats
export type AlertInterval =
  | '1m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '6h'
  | '12h'
  | '1d';

export type AlertChannel = {
  type: 'webhook';
  webhookId: string;
};

export type AlertSource = 'LOG' | 'CHART';
export interface AlertHistory {
  alert: string;
  counts: number;
  createdAt: Date;
  state: AlertState;
}
// end illegitimate thievery

type AlertData = {
  alert: {
    _id: string;
    type: AlertType;
    threshold: number;
    interval: AlertInterval;
    timezone: string;
    cron: string;
    channel: AlertChannel;
    state: AlertState;
    source: AlertSource;

    // chart alerts
    dashboardId?: string;
    chartId?: string;

    // log alerts
    groupBy?: string;
    logView?: string;
    message?: string;

    createdAt: string;
    updatedAt: string;
    __v: number;
  };
  // added properties above and beyond IAlert
  history: AlertHistory[];
  dashboard?: {
    name: string;
  };
  logView?: {
    name: string;
  };
};

const intervalToSeconds = (interval: AlertInterval) => {
  if (interval === '1m') return 60;
  if (interval === '5m') return 300;
  if (interval === '15m') return 900;
  if (interval === '30m') return 1800;
  if (interval === '1h') return 3600;
  if (interval === '6h') return 21600;
  if (interval === '12h') return 43200;
  if (interval === '1d') return 86400;
  return 86400;
};

function AlertHistoryCard({
  history,
  interval,
}: {
  history: AlertHistory;
  interval: AlertInterval;
}) {
  // render a red or green badge depending on whether the alert is in alert state, multiplied
  // by the number of times the alert was triggered
  if (history.state === AlertState.ALERT) {
    return (
      <div className="d-flex align-items-center">
        <div className="me-2">
          <div className="badge bg-danger">{history.counts}</div>
        </div>
      </div>
    );
  } else {
    return (
      <div className="d-flex align-items-center">
        <div className="me-2">
          <div className="badge bg-success">OK</div>
        </div>
      </div>
    );
  }
}

function AlertDetails({
  alert,
  history,
}: {
  alert: AlertData['alert'];
  history: AlertHistory[];
}) {
  const historyDisplay = history.length > 0 && (
    <>
      {history.map(historyItem => {
        return (
          <AlertHistoryCard history={historyItem} interval={alert.interval} />
        );
      })}
    </>
  );
  if (alert.state === AlertState.ALERT) {
    return (
      <>
        <div className="text-end">
          <div className="badge bg-danger">ALERT</div>
          <div className="fs-6 mt-2">
            <span className="me-2">Threshold: {alert.threshold}</span>
            <span className="me-2">Interval: {alert.interval}</span>
            <span className="me-2">Timezone: {alert.timezone}</span>
          </div>
        </div>
        {historyDisplay}
      </>
    );
  } else {
    return (
      <>
        <div className="text-end">
          <div className="badge bg-success">OK</div>
          <div className="fs-6 mt-2">
            <span className="me-2">Threshold: {alert.threshold}</span>
            <span className="me-2">Interval: {alert.interval}</span>
            <span className="me-2">Timezone: {alert.timezone}</span>
          </div>
        </div>
        {historyDisplay}
      </>
    );
  }
}

function ChartAlertCard({ alertData }: { alertData: AlertData }) {
  const { alert, history } = alertData;
  if (!alertData.dashboard) {
    throw new Error('alertData.dashboard is undefined');
  }
  return (
    <div className="bg-hdx-dark rounded p-3 d-flex align-items-center justify-content-between text-white-hover-success-trigger">
      <div>{alertData.dashboard.name}</div>
      <AlertDetails alert={alert} history={history} />
    </div>
  );
}

function LogAlertCard({ alertData }: { alertData: AlertData }) {
  const { alert, history } = alertData;
  if (!alertData.logView) {
    throw new Error('alert.logView is undefined');
  }
  return (
    <div className="bg-hdx-dark rounded p-3 d-flex align-items-center justify-content-between text-white-hover-success-trigger">
      <div>{alertData.logView.name}</div>
      <AlertDetails alert={alert} history={history} />
    </div>
  );
}

function AlertCard({ alertData }: { alertData: AlertData }) {
  const { alert } = alertData;
  console.log(alertData);

  if (alert.source === 'LOG') {
    return <LogAlertCard alertData={alertData} />;
  } else {
    return <ChartAlertCard alertData={alertData} />;
  }
}

function AlertCardList({ alertDatas }: { alertDatas: AlertData[] }) {
  return (
    <div>
      {alertDatas.map((alertData, index) => (
        <AlertCard key={index} alertData={alertData} />
      ))}
    </div>
  );
}

export default function AlertsPage() {
  const alertDatas = api.useAlerts().data?.data.alerts;

  return (
    <div className="AlertsPage d-flex" style={{ height: '100vh' }}>
      <Head>
        <title>Alerts - HyperDX</title>
      </Head>
      <AppNav fixed />
      <div className="d-flex flex-column flex-grow-1 px-3 pt-3">
        <div className="d-flex justify-content-between">
          <div className="fs-5 mb-3 fw-500">Alerts</div>
        </div>
        <div style={{ minHeight: 0 }} className="mt-4">
          <AlertCardList alertDatas={alertDatas || []} />
        </div>
      </div>
    </div>
  );
}
