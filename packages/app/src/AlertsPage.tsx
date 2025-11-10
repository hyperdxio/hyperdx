import * as React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import cx from 'classnames';
import { formatRelative } from 'date-fns';
import {
  AlertHistory,
  AlertSource,
  AlertState,
} from '@hyperdx/common-utils/dist/types';
import { Alert, Badge, Container, Group, Stack, Tooltip } from '@mantine/core';

import { PageHeader } from '@/components/PageHeader';

import api from './api';
import { withAppNav } from './layout';
import type { AlertsPageItem } from './types';

import styles from '../styles/AlertsPage.module.scss';

// TODO: exceptions latestHighestValue needs to be different condition (total count of exceptions not highest value within an exception)

function AlertHistoryCard({ history }: { history: AlertHistory }) {
  const start = new Date(history.createdAt.toString());
  const today = React.useMemo(() => new Date(), []);
  const latestHighestValue = history.lastValues.length
    ? Math.max(...history.lastValues.map(({ count }) => count))
    : 0;

  return (
    <Tooltip
      label={latestHighestValue + ' ' + formatRelative(start, today)}
      withArrow
    >
      <div
        className={cx(
          styles.historyCard,
          history.state === AlertState.OK ? styles.ok : styles.alarm,
        )}
      />
    </Tooltip>
  );
}

const HISTORY_ITEMS = 18;

function AlertHistoryCardList({ history }: { history: AlertHistory[] }) {
  const items = React.useMemo(() => {
    if (history.length < HISTORY_ITEMS) {
      return history;
    }
    return history.slice(0, HISTORY_ITEMS);
  }, [history]);

  const paddingItems = React.useMemo(() => {
    if (history.length > HISTORY_ITEMS) {
      return [];
    }
    return new Array(HISTORY_ITEMS - history.length).fill(null);
  }, [history]);

  return (
    <div className={styles.historyCardWrapper}>
      {paddingItems.map((_, index) => (
        <Tooltip label="No data" withArrow key={index}>
          <div className={styles.historyCard} />
        </Tooltip>
      ))}
      {items
        .slice()
        .reverse()
        .map((history, index) => (
          <AlertHistoryCard key={index} history={history} />
        ))}
    </div>
  );
}

function AlertDetails({ alert }: { alert: AlertsPageItem }) {
  const alertName = React.useMemo(() => {
    if (alert.source === AlertSource.TILE && alert.dashboard) {
      const tile = alert.dashboard?.tiles.find(
        tile => tile.id === alert.tileId,
      );
      const tileName = tile?.config.name || 'Tile';
      return (
        <>
          {alert.dashboard?.name}
          {tileName ? (
            <>
              <i className="bi bi-chevron-right fs-8 mx-1 text-slate-400" />
              {tileName}
            </>
          ) : null}
        </>
      );
    }
    if (alert.source === AlertSource.SAVED_SEARCH && alert.savedSearch) {
      return alert.savedSearch?.name;
    }
    return '–';
  }, [alert]);

  const alertUrl = React.useMemo(() => {
    if (alert.source === AlertSource.TILE && alert.dashboard) {
      return `/dashboards/${alert.dashboardId}?highlightedTileId=${alert.tileId}`;
    }
    if (alert.source === AlertSource.SAVED_SEARCH && alert.savedSearch) {
      return `/search/${alert.savedSearchId}`;
    }
    return '';
  }, [alert]);

  const alertIcon = (() => {
    switch (alert.source) {
      case AlertSource.TILE:
        return 'bi-graph-up';
      case AlertSource.SAVED_SEARCH:
        return 'bi-layout-text-sidebar-reverse';
      default:
        return 'bi-question';
    }
  })();

  const alertType = React.useMemo(() => {
    return (
      <>
        If value is {alert.thresholdType === 'above' ? 'over' : 'under'}{' '}
        <span className="fw-bold">{alert.threshold}</span>
        <span className="text-slate-400">&middot;</span>
      </>
    );
  }, [alert]);

  const notificationMethod = React.useMemo(() => {
    if (alert.channel.type === 'webhook') {
      return (
        <span>
          Notify via <i className="bi bi-slack"></i> Webhook
        </span>
      );
    }
  }, [alert]);

  const linkTitle = React.useMemo(() => {
    switch (alert.source) {
      case AlertSource.TILE:
        return 'Dashboard tile';
      case AlertSource.SAVED_SEARCH:
        return 'Saved search';
      default:
        return '';
    }
  }, [alert]);

  return (
    <div data-testid={`alert-card-${alert.id}`} className={styles.alertRow}>
      <Group>
        {alert.state === AlertState.ALERT && (
          <Badge variant="light" color="red">
            Alert
          </Badge>
        )}
        {alert.state === AlertState.OK && <Badge variant="light">Ok</Badge>}
        {alert.state === AlertState.DISABLED && (
          <Badge variant="light" color="gray">
            Disabled
          </Badge>
        )}

        <Stack gap={2}>
          <div>
            <Link
              data-testid={`alert-link-${alert.id}`}
              href={alertUrl}
              className={styles.alertLink}
              title={linkTitle}
            >
              <i className={`bi ${alertIcon} text-slate-200 me-2 fs-8`} />
              {alertName}
            </Link>
          </div>
          <div className="text-slate-400 fs-8 d-flex gap-2">
            {alertType}
            {notificationMethod}
            {alert.createdBy && (
              <>
                <span className="text-slate-400">&middot;</span>
                <span>
                  Created by {alert.createdBy.name || alert.createdBy.email}
                </span>
              </>
            )}
          </div>
        </Stack>
      </Group>

      <Group>
        <AlertHistoryCardList history={alert.history} />
      </Group>
    </div>
  );
}

function AlertCardList({ alerts }: { alerts: AlertsPageItem[] }) {
  const alarmAlerts = alerts.filter(alert => alert.state === AlertState.ALERT);
  const okData = alerts.filter(alert => alert.state === AlertState.OK);

  return (
    <div className="d-flex flex-column gap-4">
      {alarmAlerts.length > 0 && (
        <div>
          <div className={styles.sectionHeader}>
            <i className="bi bi-exclamation-triangle"></i> Triggered
          </div>
          {alarmAlerts.map((alert, index) => (
            <AlertDetails key={index} alert={alert} />
          ))}
        </div>
      )}
      <div>
        <div className={styles.sectionHeader}>
          <i className="bi bi-check-lg"></i> OK
        </div>
        {okData.length === 0 && (
          <div className="text-center text-slate-400 my-4 fs-8">No alerts</div>
        )}
        {okData.map((alert, index) => (
          <AlertDetails key={index} alert={alert} />
        ))}
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const { data, isError, isLoading } = api.useAlerts();

  const alerts = React.useMemo(() => data?.data || [], [data?.data]);

  return (
    <div data-testid="alerts-page" className="AlertsPage">
      <Head>
        <title>Alerts - HyperDX</title>
      </Head>
      <PageHeader>Alerts</PageHeader>
      <div className="my-4">
        <Container maw={1500}>
          <Alert
            icon={<i className="bi bi-info-circle-fill text-slate-400" />}
            color="gray"
            py="xs"
            mt="md"
          >
            Alerts can be{' '}
            <a
              href="https://clickhouse.com/docs/use-cases/observability/clickstack/alerts"
              target="_blank"
              rel="noopener noreferrer"
            >
              created
            </a>{' '}
            from dashboard charts and saved searches.
          </Alert>
          {isLoading ? (
            <div className="text-center text-slate-400 my-4 fs-8">
              Loading...
            </div>
          ) : isError ? (
            <div className="text-center text-slate-400 my-4 fs-8">Error</div>
          ) : alerts?.length ? (
            <>
              <AlertCardList alerts={alerts} />
            </>
          ) : (
            <div className="text-center text-slate-400 my-4 fs-8">
              No alerts created yet
            </div>
          )}
        </Container>
      </div>
    </div>
  );
}

AlertsPage.getLayout = withAppNav;
