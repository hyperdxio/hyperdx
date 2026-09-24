import * as React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { parseAsBoolean, parseAsStringEnum, useQueryState } from 'nuqs';
import { AlertSource, AlertState } from '@hyperdx/common-utils/dist/types';
import {
  Alert,
  Anchor,
  Button,
  Container,
  Flex,
  Group,
  Skeleton,
} from '@mantine/core';
import { useDebouncedValue, useMounted } from '@mantine/hooks';
import { IconBell, IconInfoCircleFilled } from '@tabler/icons-react';

import { AlertCardList } from '@/components/alerts/AlertCardList';
import { AlertsFilterBar } from '@/components/alerts/AlertsFilterBar';
import EmptyState from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { ALERT_STATE_FILTER_OPTIONS } from '@/utils/alerts';

import { useBrandDisplayName } from './theme/ThemeProvider';
import api from './api';
import { withAppNav } from './layout';

const SEARCH_DEBOUNCE_MS = 300;

export default function AlertsPage() {
  const brandName = useBrandDisplayName();
  const mounted = useMounted();

  const [search, setSearch] = useQueryState('search');
  const [tagFilter, setTagFilter] = useQueryState('tag');
  const [sourceFilter, setSourceFilter] = useQueryState(
    'alertSource',
    parseAsStringEnum<AlertSource>(Object.values(AlertSource)),
  );
  const [stateFilter, setStateFilter] = useQueryState(
    'state',
    parseAsStringEnum<AlertState>(
      ALERT_STATE_FILTER_OPTIONS.map(option => option.value),
    ),
  );
  const [mine, setMine] = useQueryState('mine', parseAsBoolean);

  const trimmedSearch = search?.trim() ?? '';
  const [debouncedSearch] = useDebouncedValue(
    trimmedSearch,
    SEARCH_DEBOUNCE_MS,
  );

  const { data: me, isPending: isMePending } = api.useMe();
  const { data: tagsData } = api.useTags('alert');

  const {
    data,
    isPending,
    isError,
    isPlaceholderData,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    refetch,
  } = api.useAlerts(
    {
      search: debouncedSearch,
      tag: tagFilter,
      source: sourceFilter,
      state: stateFilter,
      createdBy: mine ? me?.id : undefined,
    },
    {
      enabled: !isMePending,
    },
  );

  const alerts = React.useMemo(
    () => data?.pages.flatMap(page => page.data) ?? [],
    [data?.pages],
  );

  const onLoadMore = React.useCallback(() => {
    fetchNextPage({ cancelRefetch: false });
  }, [fetchNextPage]);

  const allTags = React.useMemo(
    () => [...(tagsData?.data ?? [])].sort(),
    [tagsData?.data],
  );

  const hasFilters = !!(
    trimmedSearch ||
    tagFilter ||
    sourceFilter ||
    stateFilter ||
    mine
  );

  // The rows on screen don't reflect the current filters yet: either they are
  // the previous filter's (placeholder) rows while the new query is in flight,
  // or the search debounce hasn't fired so the query isn't even asked for yet.
  const isSettling = isPlaceholderData || trimmedSearch !== debouncedSearch;

  const hasNoAlertsAtAll =
    !isPending && !isError && !isSettling && !hasFilters && !alerts.length;

  return (
    <div
      data-testid="alerts-page"
      className="AlertsPage"
      style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}
    >
      <Head>
        <title>Alerts - {brandName}</title>
      </Head>
      <PageHeader title="Alerts" />
      <div
        className="my-4"
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
      >
        {hasNoAlertsAtAll ? (
          // A percentage height cannot resolve through the min-height-sized
          // page root, so center with a growing flex wrapper instead.
          <Flex align="center" justify="center" style={{ flex: 1 }}>
            <EmptyState
              icon={<IconBell size={32} />}
              title="No alerts created yet"
              description={
                <>
                  Alerts can be created from{' '}
                  <Anchor component={Link} href="/dashboards">
                    dashboard charts
                  </Anchor>
                  ,{' '}
                  <Anchor component={Link} href="/search">
                    saved searches
                  </Anchor>
                  , and the{' '}
                  <Anchor component={Link} href="/chart">
                    chart explorer
                  </Anchor>
                  .
                </>
              }
            />
          </Flex>
        ) : (
          <Container maw={1500} w="100%">
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
              from dashboard charts, saved searches, and the chart explorer.
            </Alert>
            {!mounted ? (
              // SSR Hydration fails for the filter bar when there are nuqs filter values in
              // the URL, so render this skeleton until the component is mounted.
              <Skeleton h={36} mt="md" />
            ) : (
              <AlertsFilterBar
                search={search}
                onSearchChange={setSearch}
                state={stateFilter}
                onStateChange={setStateFilter}
                source={sourceFilter}
                onSourceChange={setSourceFilter}
                tag={tagFilter}
                onTagChange={setTagFilter}
                tags={allTags}
                mine={!!mine}
                onMineChange={value => setMine(value || null)}
                canFilterByCreator={me?.id != null}
                isSettling={isSettling}
              />
            )}
            <div
              data-testid="alerts-list"
              data-fetching={isSettling ? 'true' : 'false'}
              style={{ opacity: isPlaceholderData ? 0.6 : 1 }}
            >
              {isPending ? (
                <Skeleton h={100} mt="md" />
              ) : isError && !alerts.length ? (
                <Alert
                  variant="danger"
                  title="Failed to load alerts"
                  mt="md"
                  data-testid="alerts-error"
                >
                  <Group gap="xs">
                    Something went wrong fetching your alerts.
                    <Button
                      variant="secondary"
                      size="compact-xs"
                      onClick={() => refetch()}
                    >
                      Retry
                    </Button>
                  </Group>
                </Alert>
              ) : alerts.length ? (
                <AlertCardList
                  alerts={alerts}
                  // Placeholder data belongs to the previous filters; letting
                  // its hasNextPage through would page the outgoing query
                  // while the new one's first page is still in flight.
                  hasNextPage={hasNextPage && !isPlaceholderData}
                  isFetchingNextPage={isFetchingNextPage}
                  isFetchNextPageError={isFetchNextPageError}
                  onLoadMore={onLoadMore}
                />
              ) : (
                <EmptyState
                  variant="card"
                  mt="md"
                  icon={<IconBell size={32} />}
                  title="No matching alerts"
                  description="Try adjusting your search or filters."
                />
              )}
            </div>
          </Container>
        )}
      </div>
    </div>
  );
}

AlertsPage.getLayout = withAppNav;
