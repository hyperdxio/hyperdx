import * as React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useQueryState } from 'nuqs';
import ReactMarkdown from 'react-markdown';
import {
  AlertSource,
  AlertState,
  isRangeThresholdType,
} from '@hyperdx/common-utils/dist/types';
import {
  Alert,
  Anchor,
  Badge,
  Collapse,
  Container,
  Flex,
  Group,
  Select,
  Stack,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconBell,
  IconChartLine,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconHelpCircle,
  IconInfoCircleFilled,
  IconNote,
  IconSearch,
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

function getAlertDisplayName(alert: AlertsPageItem): string {
  if (alert.source === AlertSource.TILE && alert.dashboard) {
    const tile = alert.dashboard.tiles.find(t => t.id === alert.tileId);
    const tileName = tile?.config.name || 'Tile';
    return `${alert.dashboard.name} ${tileName}`;
  }
  if (alert.source === AlertSource.SAVED_SEARCH && alert.savedSearch) {
    return alert.savedSearch.name;
  }
  return '';
}

function getAlertTags(alert: AlertsPageItem): string[] {
  return alert.dashboard?.tags ?? alert.savedSearch?.tags ?? [];
}

function getAlertCreatorLabel(alert: AlertsPageItem): string | undefined {
  if (!alert.createdBy) return undefined;
  return alert.createdBy.name || alert.createdBy.email;
}

function AlertNote({ note }: { note: string }) {
  const [opened, { toggle }] = useDisclosure(false);

  return (
    <div>
      <UnstyledButton data-testid="alert-note-section" onClick={toggle} mt={4}>
        <Group gap={4}>
          <IconChevronDown
            size={12}
            style={{
              transform: opened ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 200ms',
            }}
          />
          <IconNote size={14} opacity={0.5} />
          <span className="fs-8" style={{ opacity: 0.6 }}>
            Note
          </span>
        </Group>
      </UnstyledButton>
      <Collapse expanded={opened}>
        <div
          className="hdx-markdown fs-8 mt-1"
          style={{ opacity: 0.8, paddingLeft: 20 }}
          data-testid="alert-note-content"
        >
          {opened && (
            <ReactMarkdown
              components={{
                a: props => (
                  <a
                    {...props}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                  />
                ),
                img: props => (
                  <img {...props} referrerPolicy="no-referrer" loading="lazy" />
                ),
              }}
            >
              {note}
            </ReactMarkdown>
          )}
        </div>
      </Collapse>
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
          {getAlertTags(alert).length > 0 && (
            <Group gap={4}>
              {getAlertTags(alert).map(tag => (
                <Badge key={tag} variant="light" color="gray" size="xs">
                  {tag}
                </Badge>
              ))}
            </Group>
          )}
          {alert.note && <AlertNote note={alert.note} />}
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
            <IconAlertTriangle size={14} /> Triggered
          </Group>
          {alarmAlerts.map(alert => (
            <AlertDetails key={alert._id} alert={alert} />
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
        {okData.map(alert => (
          <AlertDetails key={alert._id} alert={alert} />
        ))}
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const brandName = useBrandDisplayName();
  const { data, isError, isLoading } = api.useAlerts();

  const alerts = React.useMemo(() => data?.data || [], [data?.data]);

  const [search, setSearch] = useQueryState('search');
  const [tagFilter, setTagFilter] = useQueryState('tag');
  const [creatorFilter, setCreatorFilter] = useQueryState('creator');

  const allTags = React.useMemo(() => {
    const tags = new Set<string>();
    alerts.forEach(a => getAlertTags(a).forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [alerts]);

  const allCreators = React.useMemo(() => {
    const creators = new Set<string>();
    alerts.forEach(a => {
      const label = getAlertCreatorLabel(a);
      if (label) creators.add(label);
    });
    return Array.from(creators).sort();
  }, [alerts]);

  const filteredAlerts = React.useMemo(() => {
    let result = alerts;
    if (tagFilter) {
      result = result.filter(a => getAlertTags(a).includes(tagFilter));
    }
    if (creatorFilter) {
      result = result.filter(a => getAlertCreatorLabel(a) === creatorFilter);
    }
    if (search?.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        a =>
          getAlertDisplayName(a).toLowerCase().includes(q) ||
          getAlertTags(a).some(t => t.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [alerts, search, tagFilter, creatorFilter]);

  const hasFilters = !!(search?.trim() || tagFilter || creatorFilter);

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
            <Flex align="center" mt="md" gap="sm" data-testid="alerts-filters">
              <TextInput
                placeholder="Search by name"
                leftSection={<IconSearch size={16} />}
                value={search ?? ''}
                onChange={e => setSearch(e.currentTarget.value || null)}
                style={{ flex: 1, maxWidth: 400 }}
                miw={100}
                data-testid="alerts-search-input"
              />
              {allTags.length > 0 && (
                <Select
                  placeholder="Filter by tag"
                  data={allTags}
                  value={tagFilter}
                  onChange={v => setTagFilter(v)}
                  clearable
                  searchable
                  style={{ maxWidth: 200 }}
                  data-testid="alerts-tag-filter"
                />
              )}
              {allCreators.length > 0 && (
                <Select
                  placeholder="Filter by creator"
                  data={allCreators}
                  value={creatorFilter}
                  onChange={v => setCreatorFilter(v)}
                  clearable
                  searchable
                  style={{ maxWidth: 250 }}
                  data-testid="alerts-creator-filter"
                />
              )}
            </Flex>
            {filteredAlerts.length > 0 ? (
              <AlertCardList alerts={filteredAlerts} />
            ) : (
              <EmptyState
                variant="card"
                icon={<IconBell size={32} />}
                title={hasFilters ? 'No matching alerts' : 'No alerts'}
                description={
                  hasFilters
                    ? 'Try adjusting your search or filters.'
                    : 'All alerts in OK state will appear here.'
                }
              />
            )}
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
