import Head from 'next/head';
import Link from 'next/link';
import { formatRelative } from 'date-fns';

import api from './api';
import AppNav from './AppNav';
import type { Alert, AlertHistory } from './types';
import { AlertState } from './types';

type AlertData = Alert & {
  history: AlertHistory[];
  dashboard?: {
    name: string;
  };
  logViewObj?: {
    name: string;
  };
};

function AlertHistoryCard({ history }: { history: AlertHistory }) {
  const start = new Date(history.createdAt.toString());
  const latestValues = history.lastValues
    .map(({ count }, index) => {
      return count.toString();
    })
    .join(', ');
  return (
    <div
      className={
        'badge ' +
        (history.state === AlertState.OK ? 'bg-success ' : 'bg-danger ') +
        ' m-0 rounded-0'
      }
      title={latestValues + ' ' + formatRelative(start, new Date())}
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

function disableAlert(alertId?: string) {
  if (!alertId) {
    return; // no ID yet to disable?
  }
  // TODO do some lovely disabling of the alert here
}

function AlertDetails({
  alert,
  history,
}: {
  alert: AlertData;
  history: AlertHistory[];
}) {
  // TODO enable once disable handler is implemented above
  const showDisableButton = false;
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
        {showDisableButton ? (
          <button
            className="btn btn-sm btn-outline-secondary"
            title="Disable/enable"
            onClick={() => {
              disableAlert(alert._id);
            }}
          >
            <i className="bi bi-gear"></i>
          </button>
        ) : null}
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
          {history.length > 0 && history[0]?.lastValues.length > 0 && (
            <span className="fw-light">
              {' '}
              (most recently{' '}
              {history[0].lastValues.map(({ count }) => count).join(', ')})
            </span>
          )}
        </div>
      </div>
      <AlertHistoryCardList history={history} />
    </>
  );
}

function ChartAlertCard({ alert }: { alert: AlertData }) {
  const { history } = alert;
  if (!alert.dashboard) {
    throw new Error('alertData.dashboard is undefined');
  }
  return (
    <div className="bg-hdx-dark rounded p-3 d-flex align-items-center justify-content-between text-white-hover-success-trigger">
      <Link href={`/dashboards/${alert.dashboardId}`} key={alert.dashboardId}>
        {alert.dashboard.name}
      </Link>
      <AlertDetails alert={alert} history={history} />
    </div>
  );
}

function LogAlertCard({ alert }: { alert: AlertData }) {
  const { history } = alert;
  if (!alert.logViewObj) {
    throw new Error('alert.logView is undefined');
  }
  return (
    <div className="bg-hdx-dark rounded p-3 d-flex align-items-center justify-content-between text-white-hover-success-trigger">
      <Link href={`/search/${alert.logView}`} key={alert.logView}>
        {alert.logViewObj?.name}
      </Link>
      <AlertDetails alert={alert} history={history} />
    </div>
  );
}

function AlertCard({ alert }: { alert: AlertData }) {
  if (alert.source === 'LOG') {
    return <LogAlertCard alert={alert} />;
  } else {
    return <ChartAlertCard alert={alert} />;
  }
}

function AlertCardList({ alerts }: { alerts: AlertData[] }) {
  const alarmAlerts = alerts.filter(alert => alert.state === AlertState.ALERT);
  const okData = alerts.filter(alert => alert.state === AlertState.OK);
  const disabledData = alerts.filter(
    alert =>
      alert.state === AlertState.DISABLED ||
      alert.state === AlertState.INSUFFICIENT_DATA,
  );
  return (
    <div>
      {alarmAlerts.length > 0 && (
        <div>
          <div className="fs-5 mb-3 text-danger">
            <i className="bi bi-exclamation-triangle"></i> Alarmed
          </div>
          {alarmAlerts.map((alert, index) => (
            <AlertCard key={index} alert={alert} />
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
        {okData.map((alert, index) => (
          <AlertCard key={index} alert={alert} />
        ))}
      </div>
      <div>
        <div className="fs-5 mb-3">
          <i className="bi bi-stop"></i> Disabled
        </div>
        {disabledData.length === 0 && (
          <div className="text-center text-muted">No alerts</div>
        )}
        {disabledData.map((alert, index) => (
          <AlertCard key={index} alert={alert} />
        ))}
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const alerts = api.useAlerts().data?.data.alerts;
  console.log(alerts);
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
        <div className="fw-light">
          Note that for now, you&apos;ll need to go to either the dashboard or
          saved search pages in order to create alerts. This is merely a place
          to enable/disable and get an overview of which alerts are in which
          state.
        </div>
        <div style={{ minHeight: 0 }} className="mt-4">
          <AlertCardList alerts={alerts || []} />
        </div>
      </div>
    </div>
  );
}
