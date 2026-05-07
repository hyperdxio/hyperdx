import * as React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { Trans } from 'next-i18next/pages';
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
        <Trans>If value</Trans> {thresholdLabel}{' '}
        <span className="fw-bold">{alert.threshold}</span>
        {isRangeThresholdType(alert.thresholdType) && (
          <>
            {' '}
            <Trans>and</Trans>{' '}
            <span className="fw-bold">{alert.thresholdMax ?? '-'}</span>
          </>
        )}
        <span>&middot;</span>
      </>
    );
  }, [alert]);

  const notificationMethod = React.useMemo(() => {
    return (
      <Group gap={5}>
        <Trans>Notify via</Trans> {getWebhookChannelIcon(alert.channel.type)}{' '}
        <Trans>Webhook</Trans>
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
            <Trans>Alert</Trans>
          </Badge>
        )}
        {alert.state === AlertState.OK && (
          <Badge variant="light">
            <Trans>Ok</Trans>
          </Badge>
        )}
        {alert.state === AlertState.DISABLED && (
          <Badge variant="light" color="gray">
            <Trans>Disabled</Trans>
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
                  <Trans>Created by</Trans>{' '}
                  {alert.createdBy.name || alert.createdBy.email}
                </span>
              </>
            )}
          </div>
        </Stack>
      </Group>

      <Group>
        <AlertHistoryCardList alert={alert} alertUrl={alertUrl} />
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
            <IconAlertTriangle size={14} /> <Trans>Triggered</Trans>
          </Group>
          {alarmAlerts.map((alert, index) => (
            <AlertDetails key={index} alert={alert} />
          ))}
        </div>
      )}
      <div>
        <Group className={styles.sectionHeader}>
          <IconCheck size={14} /> <Trans>OK</Trans>
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
        <title>
          <Trans>Alerts -</Trans> {brandName}
        </title>
      </Head>
      <PageHeader>
        <Trans>Alerts</Trans>
      </PageHeader>
      <div className="my-4" style={{ flex: 1 }}>
        {isLoading ? (
          <div className="text-center my-4 fs-8">
            <Trans>Loading...</Trans>
          </div>
        ) : isError ? (
          <div className="text-center my-4 fs-8">
            <Trans>Error</Trans>
          </div>
        ) : alerts?.length ? (
          <Container maw={1500}>
            <Alert
              icon={<IconInfoCircleFilled size={16} />}
              color="gray"
              py="xs"
              mt="md"
            >
              <Trans>Alerts can be</Trans>{' '}
              <a
                href="https://clickhouse.com/docs/use-cases/observability/clickstack/alerts"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Trans>created</Trans>
              </a>{' '}
              <Trans>from dashboard charts and saved searches.</Trans>
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
                <Trans>Alerts can be created from</Trans>{' '}
                <Anchor component={Link} href="/dashboards">
                  <Trans>dashboard charts</Trans>
                </Anchor>{' '}
                <Trans>and</Trans>{' '}
                <Anchor component={Link} href="/search">
                  <Trans>saved searches</Trans>
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
