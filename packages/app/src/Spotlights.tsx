// @ts-nocheck TODO: remove this line

import * as React from 'react';
import { useRouter } from 'next/router';
import { Spotlight, SpotlightActionData } from '@mantine/spotlight';

import api from './api';
import Logo from './Icon';
import { useSavedSearches } from './savedSearch';

import '@mantine/spotlight/styles.css';

export const useSpotlightActions = () => {
  const router = useRouter();
  const { pathname, query } = router;

  const { data: logViewsData } = useSavedSearches();
  const { data: dashboardsData } = api.useDashboards();

  // Helper to build URL with search context
  const buildUrlWithContext = React.useCallback(
    (basePath: string) => {
      const params = new URLSearchParams();

      // Carry over time range
      if (query.from) {
        params.set('from', query.from as string);
      }
      if (query.to) {
        params.set('to', query.to as string);
      }
      if (query.tq) {
        params.set('tq', query.tq as string);
      }

      // Carry over search context
      if (query.source) {
        params.set('source', query.source as string);
      }
      if (query.where) {
        params.set('where', query.where as string);
      }
      if (query.whereLanguage) {
        params.set('whereLanguage', query.whereLanguage as string);
      }

      const paramsStr = params.toString();
      return paramsStr ? `${basePath}?${paramsStr}` : basePath;
    },
    [query],
  );

  const actions = React.useMemo<SpotlightActionData[]>(() => {
    const logViews = logViewsData ?? [];
    const dashboards = dashboardsData ?? [];

    const logViewActions: SpotlightActionData[] = [];

    // Saved searches
    logViews.forEach(logView => {
      logViewActions.push({
        id: logView._id,
        group: 'Saved searches',
        leftSection: <i className="bi bi-layout-text-sidebar-reverse" />,
        description: logView.query,
        label: logView.name,
        keywords: ['search', 'log', 'saved'],
        onClick: () => {
          router.push(`/search/${logView._id}`);
        },
      });
    });

    // Dashboards
    dashboards.forEach(dashboard => {
      logViewActions.push({
        id: dashboard._id,
        group: 'Dashboards',
        leftSection: <i className="bi bi-grid-1x2" />,
        label: dashboard.name,
        keywords: ['dashboard'],
        onClick: () => {
          router.push(`/dashboards/${dashboard._id}`);
        },
      });
    });

    logViewActions.push(
      {
        id: 'search',
        group: 'Menu',
        leftSection: <i className="bi bi-layout-text-sidebar-reverse" />,
        label: 'Search',
        description: 'Start a new search',
        keywords: ['log', 'events', 'logs'],
        onClick: () => {
          const url = pathname?.includes('/chart')
            ? buildUrlWithContext('/search')
            : '/search';
          router.push(url);
        },
      },
      {
        id: 'chart-explorer',
        group: 'Menu',
        leftSection: <i className="bi bi-graph-up" />,
        label: 'Chart Explorer',
        description: 'Explore your data',
        keywords: ['graph', 'metrics'],
        onClick: () => {
          const url = pathname?.includes('/search')
            ? buildUrlWithContext('/chart')
            : '/chart';
          router.push(url);
        },
      },
      {
        id: 'new-dashboard',
        group: 'Menu',
        leftSection: <i className="bi bi-grid-1x2" />,
        label: 'New Dashboard',
        description: 'Create a new dashboard',
        keywords: ['graph'],
        onClick: () => {
          router.push('/dashboards');
        },
      },
      {
        id: 'sessions',
        group: 'Menu',
        leftSection: <i className="bi bi-laptop" />,
        label: 'Client Sessions',
        description: 'View client sessions',
        keywords: ['browser', 'web'],
        onClick: () => {
          router.push('/sessions');
        },
      },
      {
        id: 'alerts',
        group: 'Menu',
        leftSection: <i className="bi bi-bell" />,
        label: 'Alerts',
        description: 'View and manage alerts',
        onClick: () => {
          router.push('/alerts');
        },
      },
      {
        id: 'service-health',
        group: 'Menu',
        label: 'Service Health',
        leftSection: <i className="bi bi-heart-pulse" />,
        description: 'HTTP, Database and Infrastructure metrics',
        onClick: () => {
          router.push('/services');
        },
      },
      {
        id: 'team-settings',
        group: 'Menu',
        leftSection: <i className="bi bi-gear" />,
        label: 'Team Settings',

        onClick: () => {
          router.push('/team');
        },
      },
      {
        id: 'documentation',
        group: 'Menu',
        leftSection: <i className="bi bi-question-circle" />,
        label: 'Documentation',
        keywords: ['help', 'docs'],
        onClick: () => {
          router.push(
            'https://clickhouse.com/docs/use-cases/observability/clickstack',
          );
        },
      },
      {
        id: 'cloud',
        group: 'Menu',
        leftSection: <Logo />,
        label: 'HyperDX Cloud',
        description: 'Ready to use HyperDX Cloud? Get started for free.',
        keywords: ['account', 'profile'],
        onClick: () => {
          router.push('https://hyperdx.io/register');
        },
      },
    );

    return logViewActions;
  }, [
    logViewsData,
    dashboardsData,
    router,
    pathname,
    query,
    buildUrlWithContext,
  ]);

  return { actions };
};

export const HDXSpotlightProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { actions } = useSpotlightActions();

  return (
    <div className="notranslate" translate="no">
      {children}
      <Spotlight
        shortcut="mod + K"
        searchProps={{
          leftSection: <i className="bi bi-search" />,
          placeholder: 'Search',
        }}
        nothingFound="Nothing found"
        zIndex={200001} // above the autocomplete
        tagsToIgnore={[]}
        highlightQuery
        actions={actions}
        limit={7}
        scrollable
      />
    </div>
  );
};
