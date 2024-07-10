import * as React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import cx from 'classnames';
import { add, Duration, formatRelative } from 'date-fns';
import { ErrorBoundary } from 'react-error-boundary';
import { useQueryClient } from 'react-query';
import { ArrayParam, useQueryParam, withDefault } from 'use-query-params';
import {
  Alert as MAlert,
  Badge,
  Button,
  Container,
  Group,
  Menu,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import api from './api';
import { withAppNav } from './layout';
import { Tags } from './Tags';
import type { Alert, AlertData, AlertHistory } from './types';
import { AlertState } from './types';
import { FormatTime } from './useFormatTime';

import styles from '../styles/AlertsPage.module.scss';

const DISABLE_ALERTS_ENABLED = false;

function AlertHistoryCard({ history }: { history: AlertHistory }) {
  const start = new Date(history.createdAt.toString());
  const today = React.useMemo(() => new Date(), []);
  const latestHighestValue = history.lastValues.length
    ? Math.max(...history.lastValues.map(({ count }) => count))
    : 0;
  return (
    <Tooltip
      label={latestHighestValue + ' ' + formatRelative(start, today)}
      color="dark"
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
        <Tooltip label="No data" color="dark" withArrow key={index}>
          <div className={styles.historyCard} />
        </Tooltip>
      ))}
      {[...items].reverse().map((history, index) => (
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

function AckAlert({ alert }: { alert: Alert }) {
  const queryClient = useQueryClient();
  const silenceAlert = api.useSilenceAlert();
  const unsilenceAlert = api.useUnsilenceAlert();

  const mutateOptions = React.useMemo(
    () => ({
      onSuccess: () => {
        queryClient.invalidateQueries('alerts');
      },
      onError: () => {
        notifications.show({
          color: 'red',
          message: 'Failed to silence alert, please try again later.',
        });
      },
    }),
    [queryClient],
  );

  const handleUnsilenceAlert = React.useCallback(() => {
    unsilenceAlert.mutate(alert._id || '', mutateOptions); // TODO: update types
  }, [alert._id, mutateOptions, unsilenceAlert]);

  const isNoLongerMuted = React.useMemo(() => {
    return alert.silenced ? new Date() > new Date(alert.silenced.until) : false;
  }, [alert.silenced]);

  const handleSilenceAlert = React.useCallback(
    (duration: Duration) => {
      const mutedUntil = add(new Date(), duration);
      silenceAlert.mutate(
        {
          alertId: alert._id || '', // TODO: update types
          mutedUntil,
        },
        mutateOptions,
      );
    },
    [alert._id, mutateOptions, silenceAlert],
  );

  if (alert.silenced?.at) {
    return (
      <ErrorBoundary fallback={<>Something went wrong</>}>
        <Menu>
          <Menu.Target>
            <Button
              size="compact-sm"
              variant="light"
              color={isNoLongerMuted ? 'orange' : 'green'}
              leftSection={<i className="bi bi-bell-slash fs-8" />}
            >
              Ack&apos;d
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label py={6}>
              Acknowledged{' '}
              {alert.silenced?.by ? (
                <>
                  by <strong>{alert.silenced?.by}</strong>
                </>
              ) : null}{' '}
              on <br />
              <FormatTime value={alert.silenced?.at} />
              .<br />
            </Menu.Label>

            <Menu.Label py={6}>
              {isNoLongerMuted ? (
                'Alert resumed.'
              ) : (
                <>
                  Resumes <FormatTime value={alert.silenced.until} />.
                </>
              )}
            </Menu.Label>
            <Menu.Item
              lh="1"
              py={8}
              color="orange"
              onClick={handleUnsilenceAlert}
              disabled={unsilenceAlert.isLoading}
            >
              {isNoLongerMuted ? 'Unacknowledge' : 'Resume alert'}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </ErrorBoundary>
    );
  }

  if (alert.state === 'ALERT') {
    return (
      <ErrorBoundary fallback={<>Something went wrong</>}>
        <Menu disabled={silenceAlert.isLoading}>
          <Menu.Target>
            <Button size="compact-sm" variant="default">
              Ack
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label lh="1" py={6}>
              Acknowledge and silence for
            </Menu.Label>
            <Menu.Item
              lh="1"
              py={8}
              onClick={() =>
                handleSilenceAlert({
                  minutes: 30,
                })
              }
            >
              30 minutes
            </Menu.Item>
            <Menu.Item
              lh="1"
              py={8}
              onClick={() =>
                handleSilenceAlert({
                  hours: 1,
                })
              }
            >
              1 hour
            </Menu.Item>
            <Menu.Item
              lh="1"
              py={8}
              onClick={() =>
                handleSilenceAlert({
                  hours: 6,
                })
              }
            >
              6 hours
            </Menu.Item>
            <Menu.Item
              lh="1"
              py={8}
              onClick={() =>
                handleSilenceAlert({
                  hours: 24,
                })
              }
            >
              24 hours
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </ErrorBoundary>
    );
  }

  return null;
}

function AlertDetails({ alert }: { alert: AlertData }) {
  const alertName = React.useMemo(() => {
    if (alert.source === 'CHART' && alert.dashboard) {
      const chartName = alert.dashboard.charts.find(
        chart => chart.id === alert.chartId,
      )?.name;
      return (
        <>
          {alert.dashboard.name}
          {chartName ? (
            <>
              <i className="bi bi-chevron-right fs-8 mx-1 text-slate-400" />
              {chartName}
            </>
          ) : null}
        </>
      );
    }
    if (alert.source === 'LOG' && alert.logView) {
      return alert.logView?.name;
    }
    if (alert.source === 'CUSTOM') {
      return alert.name;
    }
    return '–';
  }, [alert]);

  const alertUrl = React.useMemo(() => {
    if (alert.source === 'CHART' && alert.dashboard) {
      return `/dashboards/${alert.dashboard._id}?highlightedChartId=${alert.chartId}`;
    }
    if (alert.source === 'LOG' && alert.logView) {
      return `/search/${alert.logView._id}`;
    }
    if (alert.source === 'CUSTOM') {
      const config = {
        id: '',
        name: `${alert.name} Dashboard`,
        charts: [
          {
            id: '4rro4',
            name: `${alert.name} Chart`,
            x: 0,
            y: 0,
            w: 12,
            h: 5,
            series:
              alert?.customConfig?.series.map(s => {
                return {
                  ...s,
                  type: 'time',
                };
              }) ?? [],
            seriesReturnType: 'column',
          },
        ],
      };

      return `/dashboards?config=${encodeURIComponent(JSON.stringify(config))}`;
    }
    return '';
  }, [alert]);

  const alertIcon = (() => {
    switch (alert.source) {
      case 'CHART':
        return 'bi-graph-up';
      case 'LOG':
        return 'bi-layout-text-sidebar-reverse';
      case 'CUSTOM':
        return 'bi-robot';
      default:
        return 'bi-question';
    }
  })();

  const alertType = React.useMemo(() => {
    if (alert.source === 'LOG') {
      return (
        <>
          If count is {alert.type === 'presence' ? 'over' : 'under'}{' '}
          <span className="fw-bold">{alert.threshold}</span>
          <span className="text-slate-400">&middot;</span>
        </>
      );
    } else if (alert.source === 'CUSTOM') {
      return <>If event occurrence is anomalous</>;
    } else if (alert.source === 'CHART' && alert.checker?.type === 'anomaly') {
      const threshold = alert.checker.config?.models?.find(
        m => m.name === 'zscore',
      )?.params.threshold;
      return (
        <>
          If value exceeds {threshold} stdv from the last {alert.interval}{' '}
          window average
        </>
      );
    } else {
      return (
        <>
          If value is {alert.type === 'presence' ? 'over' : 'under'}{' '}
          <span className="fw-bold">{alert.threshold}</span>
          <span className="text-slate-400">&middot;</span>
        </>
      );
    }
  }, [alert]);

  const linkTitle = React.useMemo(() => {
    switch (alert.source) {
      case 'CHART':
        return 'Dashboard chart';
      case 'LOG':
        return 'Saved search';
      case 'CUSTOM':
        return 'Custom chart';
      default:
        return '';
    }
  }, [alert]);

  return (
    <div className={styles.alertRow}>
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
            {alert.channel.type === 'webhook' && (
              <span>Notify via Webhook</span>
            )}
          </div>
        </Stack>
      </Group>

      <Group>
        <AckAlert alert={alert} />
        <AlertHistoryCardList history={alert.history} />
        {/* can we disable an alert that is alarming? hmmmmm */}
        {/* also, will make the alert jump from under the cursor to the disabled area */}
        {DISABLE_ALERTS_ENABLED ? (
          <Button
            size="compact-xs"
            color="gray"
            onClick={() => {
              disableAlert(alert._id);
            }}
          >
            Disable
          </Button>
        ) : null}
      </Group>
    </div>
  );
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
      {DISABLE_ALERTS_ENABLED && (
        <div>
          <div className={styles.sectionHeader}>
            <i className="bi bi-stop"></i> Disabled
          </div>
          {disabledData.length === 0 && (
            <div className="text-center text-slate-400 my-4 fs-8">
              No alerts
            </div>
          )}
          {disabledData.map((alert, index) => (
            <AlertDetails key={index} alert={alert} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AlertsPage() {
  const { data, isError, isLoading } = api.useAlerts();
  const alerts = React.useMemo(
    () => (data?.data || []) as AlertData[],
    [data?.data],
  );

  // TODO: Error and loading states

  const [_tags, setTags] = useQueryParam(
    'tags',
    withDefault(ArrayParam, [] as (string | null)[]),
    { updateType: 'replaceIn' },
  );
  const tags = React.useMemo(() => _tags.filter(Boolean) as string[], [_tags]);

  const filteredAlerts = React.useMemo(() => {
    if (!tags.length) {
      return alerts;
    }
    return alerts.filter(alert =>
      [...(alert.dashboard?.tags || []), ...(alert.logView?.tags || [])].some(
        tag => tags.includes(tag),
      ),
    );
  }, [tags, alerts]);

  return (
    <div className="AlertsPage">
      <Head>
        <title>Alerts - HyperDX</title>
      </Head>
      <div className={styles.sectionHeader}>
        Your Alerts
        <Text size="sm" c="gray.6" mt="xs">
          Alerts created from dashboard charts and saved searches
        </Text>
      </div>
      <div className="my-4">
        <Container maw={1500}>
          <MAlert
            icon={<i className="bi bi-info-circle-fill text-slate-400" />}
            color="gray"
            py="xs"
            mt="md"
          >
            Alerts can be{' '}
            <a
              href="https://www.hyperdx.io/docs/alerts"
              target="_blank"
              rel="noopener noreferrer"
            >
              created
            </a>{' '}
            from dashboard charts and saved searches.
          </MAlert>
          {isLoading ? (
            <div className="text-center text-slate-400 my-4 fs-8">
              Loading...
            </div>
          ) : isError ? (
            <div className="text-center text-slate-400 my-4 fs-8">Error</div>
          ) : alerts?.length ? (
            <>
              <Button.Group mt="xl">
                <Tags values={tags} onChange={setTags}>
                  <Button
                    size="xs"
                    variant="default"
                    leftSection={
                      <i
                        className={cx(
                          'bi bi-funnel-fill',
                          tags.length ? 'text-success' : 'text-slate-400',
                        )}
                      />
                    }
                  >
                    {tags.length ? (
                      <>
                        <span className="text-slate-400 me-1">Tags </span>
                        {tags?.join(', ')}
                      </>
                    ) : (
                      <span className="text-slate-400">Filter by Tags</span>
                    )}
                  </Button>
                </Tags>
                {tags.length > 0 && (
                  <Button
                    size="xs"
                    variant="default"
                    onClick={() => setTags([])}
                    px="xs"
                  >
                    <i className="bi bi-x-lg" />
                  </Button>
                )}
              </Button.Group>
              <AlertCardList alerts={filteredAlerts} />
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
