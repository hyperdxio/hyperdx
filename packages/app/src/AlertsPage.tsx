import * as React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import {
  AlertSource,
  AlertState,
  isRangeThresholdType,
} from '@hyperdx/common-utils/dist/types';
import { Alert, Anchor, Badge, Container, Group, Stack } from '@mantine/core';
import {
  IconAlertTriangle,
  IconBell,
  IconChartLine,
  IconCheck,
  IconChevronRight,
  IconHelpCircle,
  IconInfoCircleFilled,
  IconTableRow,
} from '@tabler/icons-react';

import { AckAlert } from '@/components/alerts/AckAlert';
import { AlertHistoryCardList } from '@/components/alerts/AlertHistoryCards';
import EmptyState from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

import { useBrandDisplayName } from './theme/ThemeProvider';
import { TILE_ALERT_THRESHOLD_TYPE_OPTIONS } from './utils/alerts';
import { getWebhookChannelIcon } from './utils/webhookIcons';
import api from './api';
import { withAppNav } from './layout';
import type { AlertsPageItem } from './types';

import styles from '../styles/AlertsPage.module.scss';

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
    const thresholdLabel =
      TILE_ALERT_THRESHOLD_TYPE_OPTIONS[alert.thresholdType] ??
      alert.thresholdType;
    return (
      <>
        If value {thresholdLabel}{' '}
        <span className="fw-bold">{alert.threshold}</span>
        {isRangeThresholdType(alert.thresholdType) && (
          <>
            {' '}
            and <span className="fw-bold">{alert.thresholdMax ?? '-'}</span>
          </>
        )}
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
          <Badge variant="light" color="red" data-testid="alert-state-badge">
            Alert
          </Badge>
        )}
        {alert.state === AlertState.OK && (
          <Badge variant="light" data-testid="alert-state-badge">
            Ok
          </Badge>
        )}
        {alert.state === AlertState.DISABLED && (
          <Badge variant="light" color="gray" data-testid="alert-state-badge">
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
          <EmptyState
            variant="card"
            icon={<IconBell size={32} />}
            title="No alerts"
            description="All alerts in OK state will appear here."
          />
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
    <div
      data-testid="alerts-page"
      className="AlertsPage"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <Head>
        <title>Alerts - {brandName}</title>
      </Head>
      <PageHeader>Alerts</PageHeader>
      <div className="my-4" style={{ flex: 1 }}>
        {isLoading ? (
          <div className="text-center my-4 fs-8">Loading...</div>
        ) : isError ? (
          <div className="text-center my-4 fs-8">Error</div>
        ) : alerts?.length ? (
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
            <AlertCardList alerts={alerts} />
          </Container>
        ) : (
          <EmptyState
            h="100%"
            icon={<IconBell size={32} />}
            title="No alerts created yet"
            description={
              <>
                Alerts can be created from{' '}
                <Anchor component={Link} href="/dashboards">
                  dashboard charts
                </Anchor>{' '}
                and{' '}
                <Anchor component={Link} href="/search">
                  saved searches
                </Anchor>
                .
              </>
            }
          />
        )}
      </div>
    </div>
  );
}

AlertsPage.getLayout = withAppNav;
