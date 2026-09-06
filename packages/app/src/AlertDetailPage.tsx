import * as React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { AlertInterval } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Anchor,
  Breadcrumbs,
  Container,
  Group,
  Skeleton,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconExternalLink } from '@tabler/icons-react';

import { AckAlert } from '@/components/alerts/AckAlert';
import { AlertDetailChart } from '@/components/alerts/AlertDetailChart';
import { AlertDetailProperties } from '@/components/alerts/AlertDetailProperties';
import { AlertNote } from '@/components/alerts/AlertDetails';
import { AlertEvaluationsTable } from '@/components/alerts/AlertEvaluationsTable';
import { AlertHistoryCardList } from '@/components/alerts/AlertHistoryCards';
import { AlertRowMenu } from '@/components/alerts/AlertRowMenu';
import { AlertStateBadge } from '@/components/alerts/AlertStateBadge';
import EmptyState from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { TimePicker } from '@/components/TimePicker';
import { IS_ALERT_DETAILS_ENABLED } from '@/config';
import { getAlertSourceLabel, getAlertSourceUrl } from '@/utils/alerts';

import { useBrandDisplayName } from './theme/ThemeProvider';
import api from './api';
import { withAppNav } from './layout';
import { parseTimeQuery, useNewTimeQuery } from './timeQuery';
import type { AlertsPageItem } from './types';

import styles from '@styles/AlertsPage.module.scss';

/**
 * Default chart range for the alert's evaluation interval. The chart buckets
 * at the interval, so a fixed short default renders only a bucket or two for
 * long-interval alerts (granularity >= duration). Each default shows at
 * least ~24 evaluation windows; evaluations retention is 31d, so the 1d
 * interval caps at 30d.
 */
function getDefaultTimeRangeLabel(interval: AlertInterval): string {
  switch (interval) {
    case '30m':
      return 'Past 1d';
    case '1h':
      return 'Past 2d';
    case '6h':
      return 'Past 7d';
    case '12h':
      return 'Past 14d';
    case '1d':
      return 'Past 30d';
    default:
      // 1m / 5m / 15m
      return 'Past 12h';
  }
}

// Number of evaluation windows in the timeline strip — wider than the
// alerts-page strip so failure/firing patterns over time are visible.
const TIMELINE_ITEMS = 60;

function AlertProperties({ alert }: { alert: AlertsPageItem }) {
  return (
    <Stack gap={2}>
      <AlertDetailProperties alert={alert} />
      {alert.note && <AlertNote note={alert.note} />}
    </Stack>
  );
}

function AlertDetailBody({ alert }: { alert: AlertsPageItem }) {
  const alertUrl = getAlertSourceUrl(alert);
  const router = useRouter();

  // Interval-dependent, but fixed for the page lifetime: the body only
  // mounts once the alert has loaded, and useNewTimeQuery reads the initial
  // values once (a from/to in the URL still takes precedence).
  const defaultTimeRangeLabel = getDefaultTimeRangeLabel(alert.interval);
  const defaultTimeRange = React.useMemo(
    () => parseTimeQuery(defaultTimeRangeLabel, false) as [Date, Date],
    [defaultTimeRangeLabel],
  );
  const [displayedTimeInputValue, setDisplayedTimeInputValue] = React.useState(
    defaultTimeRangeLabel,
  );
  const { searchedTimeRange, onSearch } = useNewTimeQuery({
    initialDisplayValue: defaultTimeRangeLabel,
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
              {alert.displayName || 'Alert'}
            </Text>
          </Breadcrumbs>
        }
        leading={
          <Group gap="sm">
            {alert.state != null && <AlertStateBadge state={alert.state} />}
            <Text fw={500} data-testid="alert-detail-name">
              {alert.displayName}
            </Text>
            {alertUrl && (
              /* Next to the name rather than in the actions row: it navigates
                 to what the alert watches, so it belongs with the identity,
                 not with the verbs acting on the alert. */
              <Tooltip
                label={`Open ${getAlertSourceLabel(alert).toLowerCase()}`}
                withArrow
              >
                <ActionIcon
                  component={Link}
                  href={alertUrl}
                  variant="subtle"
                  size="md"
                  aria-label={`Open ${getAlertSourceLabel(alert).toLowerCase()}`}
                  data-testid="open-alert-source"
                >
                  <IconExternalLink size={16} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        }
        actions={
          <Group gap="sm" wrap="nowrap">
            <AckAlert alert={alert} />
            {/* Edit, Terraform export and Delete live behind one overflow
                control, shared with the alerts list so both surfaces offer the
                same actions. The menu's own source-link item is suppressed:
                this page carries that link next to the title instead. */}
            <AlertRowMenu
              alert={alert}
              alertName={alert.displayName}
              dateRange={searchedTimeRange}
              onDeleted={() => router.push('/alerts')}
            />
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
          {alert ? `${alert.displayName} - Alerts` : 'Alerts'} - {brandName}
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
