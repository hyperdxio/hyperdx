import * as React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useQueryState } from 'nuqs';
import {
  Alert,
  Anchor,
  Container,
  Flex,
  Select,
  TextInput,
} from '@mantine/core';
import {
  IconBell,
  IconInfoCircleFilled,
  IconSearch,
} from '@tabler/icons-react';

import { AlertCardList } from '@/components/alerts/AlertCardList';
import EmptyState from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { getAlertCreatorLabel, getAlertSourceLabel } from '@/utils/alerts';

import { useBrandDisplayName } from './theme/ThemeProvider';
import api from './api';
import { withAppNav } from './layout';

export default function AlertsPage() {
  const brandName = useBrandDisplayName();
  const { data, isError, isLoading } = api.useAlerts();

  const alerts = React.useMemo(() => data?.data || [], [data?.data]);

  const [search, setSearch] = useQueryState('search');
  const [tagFilter, setTagFilter] = useQueryState('tag');
  const [creatorFilter, setCreatorFilter] = useQueryState('creator');
  const [sourceFilter, setSourceFilter] = useQueryState('alertSource');

  const allTags = React.useMemo(() => {
    const tags = new Set<string>();
    alerts.forEach(a => a.tags?.forEach(t => tags.add(t)));
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

  // Only the source types actually present, so the filter never offers an
  // option that yields an empty list.
  const allSources = React.useMemo(() => {
    const sources = new Set<string>();
    alerts.forEach(a => sources.add(getAlertSourceLabel(a)));
    return Array.from(sources).sort();
  }, [alerts]);

  const filteredAlerts = React.useMemo(() => {
    let result = alerts;
    if (sourceFilter) {
      result = result.filter(a => getAlertSourceLabel(a) === sourceFilter);
    }
    if (tagFilter) {
      result = result.filter(a => a.tags?.includes(tagFilter));
    }
    if (creatorFilter) {
      result = result.filter(a => getAlertCreatorLabel(a) === creatorFilter);
    }
    if (search?.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        a =>
          a.displayName?.toLowerCase().includes(q) ||
          // So "tile" / "saved search" narrow the list the same way the type
          // filter does, without having to reach for the dropdown.
          getAlertSourceLabel(a)
            .toLowerCase()
            .split(' ')
            .some(word => word.startsWith(q)) ||
          a.tags?.some(t => t.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [alerts, search, tagFilter, creatorFilter, sourceFilter]);

  const hasFilters = !!(
    search?.trim() ||
    tagFilter ||
    creatorFilter ||
    sourceFilter
  );

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
        {isLoading ? (
          <div className="text-center my-4 fs-8">Loading...</div>
        ) : isError ? (
          <div className="text-center my-4 fs-8">Error</div>
        ) : alerts?.length ? (
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
              {(allSources.length > 1 || sourceFilter) && (
                <Select
                  placeholder="Filter by alert source"
                  // A filter carried in from the URL may name a source no
                  // current alert has; keep it selectable so it can be cleared.
                  data={
                    sourceFilter && !allSources.includes(sourceFilter)
                      ? [...allSources, sourceFilter]
                      : allSources
                  }
                  value={sourceFilter}
                  onChange={v => setSourceFilter(v)}
                  clearable
                  style={{ maxWidth: 220 }}
                  data-testid="alerts-source-filter"
                />
              )}
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
                mt="md"
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
                  </Anchor>{' '}
                  and{' '}
                  <Anchor component={Link} href="/search">
                    saved searches
                  </Anchor>
                  .
                </>
              }
            />
          </Flex>
        )}
      </div>
    </div>
  );
}

AlertsPage.getLayout = withAppNav;
