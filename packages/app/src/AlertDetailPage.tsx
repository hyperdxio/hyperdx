import * as React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  AlertSource,
  isRangeThresholdType,
} from '@hyperdx/common-utils/dist/types';
import {
  Anchor,
  Breadcrumbs,
  Button,
  Container,
  Group,
  Skeleton,
  Stack,
  Text,
} from '@mantine/core';
import { IconExternalLink } from '@tabler/icons-react';

import { AckAlert } from '@/components/alerts/AckAlert';
import { AlertDetailChart } from '@/components/alerts/AlertDetailChart';
import {
  AlertEvaluationsTable,
  AlertStateBadge,
} from '@/components/alerts/AlertEvaluationsTable';
import { AlertHistoryCardList } from '@/components/alerts/AlertHistoryCards';
import EmptyState from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { TimePicker } from '@/components/TimePicker';
import { IS_ALERT_DETAILS_ENABLED } from '@/config';

import { useBrandDisplayName } from './theme/ThemeProvider';
import { TILE_ALERT_THRESHOLD_TYPE_OPTIONS } from './utils/alerts';
import { getWebhookChannelIcon } from './utils/webhookIcons';
import {
  AlertNote,
  getAlertDisplayName,
  getAlertSourceUrl,
} from './AlertsPage';
import api from './api';
import { withAppNav } from './layout';
import { parseTimeQuery, useNewTimeQuery } from './timeQuery';
import type { AlertsPageItem } from './types';

import styles from '@styles/AlertsPage.module.scss';

const DEFAULT_TIME_RANGE_LABEL = 'Past 12h';
const defaultTimeRange = parseTimeQuery(DEFAULT_TIME_RANGE_LABEL, false) as [
  Date,
  Date,
];

// Number of evaluation windows in the timeline strip — wider than the
// alerts-page strip so failure/firing patterns over time are visible.
const TIMELINE_ITEMS = 60;

function AlertProperties({ alert }: { alert: AlertsPageItem }) {
  const thresholdLabel =
    TILE_ALERT_THRESHOLD_TYPE_OPTIONS[alert.thresholdType] ??
    alert.thresholdType;

  return (
    <Stack gap={2}>
      <div className="fs-8 d-flex gap-2 align-items-center">
        <span>
          If value {thresholdLabel}{' '}
          <span className="fw-bold">{alert.threshold}</span>
          {isRangeThresholdType(alert.thresholdType) && (
            <>
              {' '}
              and <span className="fw-bold">{alert.thresholdMax ?? '-'}</span>
            </>
          )}
        </span>
        <span>&middot;</span>
        <span>Evaluates every {alert.interval}</span>
        {alert.numConsecutiveWindows != null &&
          alert.numConsecutiveWindows > 1 && (
            <>
              <span>&middot;</span>
              <span>
                Fires after {alert.numConsecutiveWindows} consecutive windows
              </span>
            </>
          )}
        <span>&middot;</span>
        <Group gap={5}>
          Notify via {getWebhookChannelIcon(alert.channel.type)} Webhook
        </Group>
        {alert.createdBy && (
          <>
            <span>&middot;</span>
            <span>
              Created by {alert.createdBy.name || alert.createdBy.email}
            </span>
          </>
        )}
      </div>
      {alert.note && <AlertNote note={alert.note} />}
    </Stack>
  );
}

function AlertDetailBody({ alert }: { alert: AlertsPageItem }) {
  const alertUrl = getAlertSourceUrl(alert);

  const [displayedTimeInputValue, setDisplayedTimeInputValue] = React.useState(
    DEFAULT_TIME_RANGE_LABEL,
  );
  const { searchedTimeRange, onSearch } = useNewTimeQuery({
    initialDisplayValue: DEFAULT_TIME_RANGE_LABEL,
    initialTimeRange: defaultTimeRange,
    setDisplayedTimeInputValue,
  });

  // The chart, timeline strip, and event stream all reflect the exact picked
  // time range. Evaluations are fetched in fixed-size pages as the user
  // scrolls (each page is a hard-bounded scan server-side, so wide ranges
  // never fetch unbounded history).
  const {
    data: evaluationsData,
    isLoading: isEvaluationsLoading,
    isError: isEvaluationsError,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = api.useAlertEvaluations(alert._id, searchedTimeRange);

  const evaluations = React.useMemo(
    () => evaluationsData?.pages.flatMap(page => page.data) ?? [],
    [evaluationsData],
  );

  // Stable callback so the scroll sentinel's effect doesn't refire on every
  // render. cancelRefetch:false makes overlapping triggers no-ops instead of
  // restarting an in-flight page fetch.
  const onLoadMore = React.useCallback(() => {
    fetchNextPage({ cancelRefetch: false });
  }, [fetchNextPage]);

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs fz="sm">
            <Anchor component={Link} href="/alerts" fz="sm" c="dimmed">
              Alerts
            </Anchor>
            <Text fz="sm" c="dimmed">
              {getAlertDisplayName(alert) || 'Alert'}
            </Text>
          </Breadcrumbs>
        }
        leading={
          <Group gap="sm">
            {alert.state != null && <AlertStateBadge state={alert.state} />}
            <Text fw={500}>{getAlertDisplayName(alert)}</Text>
          </Group>
        }
        actions={
          <Group gap="sm" wrap="nowrap">
            <AckAlert alert={alert} />
            {alertUrl && (
              <Button
                component={Link}
                href={alertUrl}
                variant="secondary"
                size="compact-sm"
                rightSection={<IconExternalLink size={14} />}
              >
                {alert.source === AlertSource.TILE
                  ? 'Open dashboard tile'
                  : 'Open saved search'}
              </Button>
            )}
            <TimePicker
              inputValue={displayedTimeInputValue}
              setInputValue={setDisplayedTimeInputValue}
              onSearch={onSearch}
            />
          </Group>
        }
      />
      <div style={{ overflow: 'auto', flexGrow: 1 }}>
        <Container size="xl" py="md">
          <Stack gap="lg">
            <AlertProperties alert={alert} />
            <AlertDetailChart
              alert={alert}
              dateRange={searchedTimeRange}
              alertUrl={alertUrl}
            />
            <div>
              <Group
                className={styles.sectionHeader}
                justify="space-between"
                mb="sm"
              >
                <span>Evaluation History</span>
                <AlertHistoryCardList
                  alert={alert}
                  alertUrl={alertUrl}
                  history={evaluations}
                  maxItems={TIMELINE_ITEMS}
                  showErrorIndicator={false}
                />
              </Group>
              <AlertEvaluationsTable
                evaluations={evaluations}
                interval={alert.interval}
                isLoading={isEvaluationsLoading}
                isError={isEvaluationsError}
                hasNextPage={hasNextPage ?? false}
                isFetchingNextPage={isFetchingNextPage}
                onLoadMore={onLoadMore}
              />
            </div>
          </Stack>
        </Container>
      </div>
    </>
  );
}

export default function AlertDetailPage() {
  const brandName = useBrandDisplayName();
  const router = useRouter();
  const alertId =
    typeof router.query.alertId === 'string' ? router.query.alertId : undefined;

  // Direct-URL guard while the feature bakes: the alerts page only renders
  // Details links when the flag is on, but the route itself must bounce too.
  React.useEffect(() => {
    if (!IS_ALERT_DETAILS_ENABLED) {
      router.replace('/alerts');
    }
  }, [router]);

  const { data, isLoading, isError } = api.useAlert(alertId);
  const alert = data?.data;

  if (!IS_ALERT_DETAILS_ENABLED) {
    return null;
  }

  return (
    <div
      data-testid="alert-detail-page"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <Head>
        <title>
          {alert ? `${getAlertDisplayName(alert)} - Alerts` : 'Alerts'} -{' '}
          {brandName}
        </title>
      </Head>
      {isLoading && (
        <Container size="xl" py="md" w="100%">
          <Stack gap="lg">
            <Skeleton h={32} w="40%" />
            <Skeleton h={280} w="100%" />
            <Skeleton h={160} w="100%" />
          </Stack>
        </Container>
      )}
      {!isLoading && (isError || !alert) && (
        <Container size="xl" py="md" w="100%">
          <EmptyState
            variant="card"
            title="Alert not found"
            description={
              <Anchor component={Link} href="/alerts" size="sm">
                Back to alerts
              </Anchor>
            }
          />
        </Container>
      )}
      {!isLoading && alert && <AlertDetailBody alert={alert} />}
    </div>
  );
}

AlertDetailPage.getLayout = withAppNav;
