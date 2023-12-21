import Head from 'next/head';
import Link from 'next/link';
import { formatRelative } from 'date-fns';

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
  lastValue: number;
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
    createdAt: string;
    updatedAt: string;
    __v: number;
    // chart alerts only
    dashboardId?: string;
    chartId?: string;

    // log alerts only
    groupBy?: string;
    logView?: string;
    message?: string;
  };
  // added properties above and beyond IAlert above
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

function AlertHistoryCard({ history }: { history: AlertHistory }) {
  const start = new Date(history.createdAt.toString());
  return (
    <div
      className={
        'badge ' +
        (history.state === AlertState.OK ? 'bg-success ' : 'bg-danger ') +
        ' m-0 rounded-0'
      }
      title={
        (history.lastValue ?? '') + ' ' + formatRelative(start, new Date())
      }
    >
      {history.state === AlertState.OK ? '.' : '!'}
    </div>
  );
}

function AlertHistoryCardList({ history }: { history: AlertHistory[] }) {
  return (
    <div className="d-flex flex-row">
      {history.map((history, index) => (
        <AlertHistoryCard key={index} history={history} />
      ))}
    </div>
  );
}

function disableAlert(alertId: string) {
  // TODO do some lovely disabling of the alert here
}

function AlertDetails({
  alert,
  history,
}: {
  alert: AlertData['alert'];
  history: AlertHistory[];
}) {
  return (
    <>
      <div className="text-end">
        {alert.state === AlertState.ALERT && (
          <div className="badge bg-danger">ALERT</div>
        )}
        {alert.state === AlertState.OK && (
          <div className="badge bg-success">OK</div>
        )}
        {alert.state === AlertState.DISABLED && (
          <div className="badge bg-secondary">DISABLED</div>
        )}{' '}
        {/* can we disable an alert that is alarming? hmmmmm */}
        {/* also, will make the alert jump from under the cursor to the disabled area */}
        <button
          className="btn btn-sm btn-outline-secondary"
          title="Disable/enable"
          onClick={() => {
            disableAlert(alert._id);
          }}
        >
          <i className="bi bi-gear"></i>
        </button>
        <div className="fs-6 mt-2">
          Alerts if
          <span className="fw-bold">
            {' '}
            {alert.source === 'LOG' ? 'count' : 'value'}{' '}
          </span>
          is
          <span className="fw-bold">
            {' '}
            {alert.type === 'presence' ? 'over' : 'under'}{' '}
          </span>
          <span className="fw-bold">{alert.threshold}</span>
          {history.length > 0 && history[0]?.lastValue && (
            <span className="fw-light">
              {' '}
              (most recently {history[0].lastValue})
            </span>
          )}
        </div>
      </div>
      <AlertHistoryCardList history={history} />
    </>
  );
}

function ChartAlertCard({ alertData }: { alertData: AlertData }) {
  const { alert, history } = alertData;
  if (!alertData.dashboard) {
    throw new Error('alertData.dashboard is undefined');
  }
  return (
    <div className="bg-hdx-dark rounded p-3 d-flex align-items-center justify-content-between text-white-hover-success-trigger">
      <Link href={`/dashboards/${alert.dashboardId}`} key={alert.dashboardId}>
        {alertData.dashboard.name}
      </Link>
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
      <Link href={`/search/${alert.logView}`} key={alert.logView}>
        {alertData.logView.name}
      </Link>
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
  const alarmData = alertDatas.filter(
    alertData => alertData.alert.state === AlertState.ALERT,
  );
  const okData = alertDatas.filter(
    alertData => alertData.alert.state === AlertState.OK,
  );
  const disabledData = alertDatas.filter(
    alertData =>
      alertData.alert.state === AlertState.DISABLED ||
      alertData.alert.state === AlertState.INSUFFICIENT_DATA,
  );
  return (
    <div>
      {alarmData.length > 0 && (
        <div>
          <div className="fs-5 mb-3 text-danger">
            <i className="bi bi-exclamation-triangle"></i> Alarmed
          </div>
          {alarmData.map((alertData, index) => (
            <AlertCard key={index} alertData={alertData} />
          ))}
        </div>
      )}
      <div>
        <div className="fs-5 mb-3">
          <i className="bi bi-repeat"></i> Running
        </div>
        {okData.length === 0 && (
          <div className="text-center text-muted">No alerts</div>
        )}
        {okData.map((alertData, index) => (
          <AlertCard key={index} alertData={alertData} />
        ))}
      </div>
      <div>
        <div className="fs-5 mb-3">
          <i className="bi bi-stop"></i> Disabled
        </div>
        {disabledData.length === 0 && (
          <div className="text-center text-muted">No alerts</div>
        )}
        {disabledData.map((alertData, index) => (
          <AlertCard key={index} alertData={alertData} />
        ))}
      </div>
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
          <div className="fs-4 mb-3">Alerts</div>
        </div>
        <div style={{ minHeight: 0 }} className="mt-4">
          <AlertCardList alertDatas={alertDatas || []} />
        </div>
      </div>
    </div>
  );
}
