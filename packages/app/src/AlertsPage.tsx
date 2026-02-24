import * as React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import cx from 'classnames';
import type { Duration } from 'date-fns';
import { add, formatRelative } from 'date-fns';
import {
  AlertHistory,
  AlertSource,
  AlertState,
} from '@hyperdx/common-utils/dist/types';
import {
  Alert,
  Badge,
  Button,
  Container,
  Group,
  Menu,
  Stack,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconBell,
  IconBrandSlack,
  IconChartLine,
  IconCheck,
  IconChevronRight,
  IconHelpCircle,
  IconInfoCircleFilled,
  IconTableRow,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';

import { ErrorBoundary } from '@/components/Error/ErrorBoundary';
import { PageHeader } from '@/components/PageHeader';

import { useBrandDisplayName } from './theme/ThemeProvider';
import { isAlertSilenceExpired } from './utils/alerts';
import { getWebhookChannelIcon } from './utils/webhookIcons';
import api from './api';
import { withAppNav } from './layout';
import type { AlertsPageItem } from './types';
import { FormatTime } from './useFormatTime';

import styles from '../styles/AlertsPage.module.scss';

function AlertHistoryCard({
  history,
  alertUrl,
}: {
  history: AlertHistory;
  alertUrl: string;
}) {
  const start = new Date(history.createdAt.toString());
  const today = React.useMemo(() => new Date(), []);

  const href = React.useMemo(() => {
    if (!alertUrl || !history.lastValues?.[0]?.startTime) return null;

    // Create time window from alert creation to last recorded value
    const to = new Date(history.createdAt).getTime();
    const from = new Date(history.lastValues[0].startTime).getTime();

    // Construct URL with time range parameters
    const url = new URL(alertUrl, window.location.origin);
    url.searchParams.set('from', from.toString());
    url.searchParams.set('to', to.toString());
    url.searchParams.set('isLive', 'false');

    return url.pathname + url.search;
  }, [history, alertUrl]);

  const content = (
    <div
      className={cx(
        styles.historyCard,
        history.state === AlertState.OK ? styles.ok : styles.alarm,
        href && styles.clickable,
      )}
    />
  );

  return (
    <Tooltip
      label={`${history.counts ?? 0} alerts ${formatRelative(start, today)}`}
      color="dark"
      withArrow
    >
      {href ? (
        <a href={href} className={styles.historyCardLink}>
          {content}
        </a>
      ) : (
        content
      )}
    </Tooltip>
  );
}

const HISTORY_ITEMS = 18;

function AckAlert({ alert }: { alert: AlertsPageItem }) {
  const queryClient = useQueryClient();
  const silenceAlert = api.useSilenceAlert();
  const unsilenceAlert = api.useUnsilenceAlert();

  const mutateOptions = React.useMemo(
    () => ({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['alerts'] });
      },
      onError: (error: any) => {
        const status = error?.response?.status;
        let message = 'Failed to silence alert, please try again later.';

        if (status === 404) {
          message = 'Alert not found.';
        } else if (status === 400) {
          message =
            'Invalid request. Please ensure the silence duration is valid.';
        }

        notifications.show({
          color: 'red',
          message,
        });
      },
    }),
    [queryClient],
  );

  const handleUnsilenceAlert = React.useCallback(() => {
    unsilenceAlert.mutate(alert._id || '', mutateOptions);
  }, [alert._id, mutateOptions, unsilenceAlert]);

  const isNoLongerMuted = React.useMemo(() => {
    return isAlertSilenceExpired(alert.silenced);
  }, [alert.silenced]);

  const handleSilenceAlert = React.useCallback(
    (duration: Duration) => {
      const mutedUntil = add(new Date(), duration);
      silenceAlert.mutate(
        {
          alertId: alert._id || '',
          mutedUntil: mutedUntil.toISOString(),
        },
        mutateOptions,
      );
    },
    [alert._id, mutateOptions, silenceAlert],
  );

  if (alert.silenced?.at) {
    return (
      <ErrorBoundary message="Failed to load alert acknowledgment menu">
        <Menu>
          <Menu.Target>
            <Button
              size="compact-sm"
              variant="primary"
              color={
                isNoLongerMuted
                  ? 'var(--color-bg-warning)'
                  : 'var(--color-bg-success)'
              }
              leftSection={<IconBell size={16} />}
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
              disabled={unsilenceAlert.isPending}
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
      <ErrorBoundary message="Failed to load alert acknowledgment menu">
        <Menu disabled={silenceAlert.isPending}>
          <Menu.Target>
            <Button size="compact-sm" variant="secondary">
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

function AlertHistoryCardList({
  history,
  alertUrl,
}: {
  history: AlertHistory[];
  alertUrl: string;
}) {
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
          <AlertHistoryCard key={index} history={history} alertUrl={alertUrl} />
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
              <IconChevronRight size={14} className="mx-1" />
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
        return <IconChartLine size={14} />;
      case AlertSource.SAVED_SEARCH:
        return <IconTableRow size={14} />;
      default:
        return <IconHelpCircle size={14} />;
    }
  })();

  const alertType = React.useMemo(() => {
    return (
      <>
        If value is {alert.thresholdType === 'above' ? 'over' : 'under'}{' '}
        <span className="fw-bold">{alert.threshold}</span>
        <span>&middot;</span>
      </>
    );
  }, [alert]);

  const notificationMethod = React.useMemo(() => {
    return (
      <Group gap={5}>
        Notify via {getWebhookChannelIcon(alert.channel.type)} Webhook
      </Group>
    );
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
    <div data-testid={`alert-card-${alert._id}`} className={styles.alertRow}>
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
              data-testid={`alert-link-${alert._id}`}
              href={alertUrl}
              className={styles.alertLink}
              title={linkTitle}
            >
              <Group gap={2}>
                {alertIcon}
                {alertName}
              </Group>
            </Link>
          </div>
          <div className="fs-8 d-flex gap-2">
            {alertType}
            {notificationMethod}
            {alert.createdBy && (
              <>
                <span>&middot;</span>
                <span>
                  Created by {alert.createdBy.name || alert.createdBy.email}
                </span>
              </>
            )}
          </div>
        </Stack>
      </Group>

      <Group>
        <AlertHistoryCardList history={alert.history} alertUrl={alertUrl} />
        <AckAlert alert={alert} />
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
          <Group className={styles.sectionHeader}>
            <IconAlertTriangle size={14} /> Triggered
          </Group>
          {alarmAlerts.map((alert, index) => (
            <AlertDetails key={index} alert={alert} />
          ))}
        </div>
      )}
      <div>
        <Group className={styles.sectionHeader}>
          <IconCheck size={14} /> OK
        </Group>
        {okData.length === 0 && (
          <div className="text-center my-4 fs-8">No alerts</div>
        )}
        {okData.map((alert, index) => (
          <AlertDetails key={index} alert={alert} />
        ))}
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const brandName = useBrandDisplayName();
  const { data, isError, isLoading } = api.useAlerts();

  const alerts = React.useMemo(() => data?.data || [], [data?.data]);

  return (
    <div data-testid="alerts-page" className="AlertsPage">
      <Head>
        <title>Alerts - {brandName}</title>
      </Head>
      <PageHeader>Alerts</PageHeader>
      <div className="my-4">
        <Container maw={1500}>
          <Alert
            icon={<IconInfoCircleFilled size={16} />}
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
            <div className="text-center my-4 fs-8">Loading...</div>
          ) : isError ? (
            <div className="text-center my-4 fs-8">Error</div>
          ) : alerts?.length ? (
            <>
              <AlertCardList alerts={alerts} />
            </>
          ) : (
            <div className="text-center my-4 fs-8">No alerts created yet</div>
          )}
        </Container>
      </div>
    </div>
  );
}

AlertsPage.getLayout = withAppNav;
