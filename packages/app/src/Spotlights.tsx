import * as React from 'react';
import { useRouter } from 'next/router';
import { SpotlightAction, SpotlightProvider } from '@mantine/spotlight';

import api from './api';
import { SERVICE_DASHBOARD_ENABLED } from './config';
import Logo from './Icon';

const useSpotlightActions = () => {
  const router = useRouter();

  const { data: logViewsData } = api.useLogViews();
  const { data: dashboardsData } = api.useDashboards();

  const actions = React.useMemo<SpotlightAction[]>(() => {
    const logViews = logViewsData?.data ?? [];
    const dashboards = dashboardsData?.data ?? [];

    const logViewActions: SpotlightAction[] = [];

    // Saved searches
    logViews.forEach(logView => {
      logViewActions.push({
        group: 'Saved searches',
        icon: <i className="bi bi-layout-text-sidebar-reverse" />,
        description: logView.query,
        title: logView.name,
        keywords: ['search', 'log', 'saved'],
        onTrigger: () => {
          router.push(`/search/${logView._id}`);
        },
      });
    });

    // Dashboards
    dashboards.forEach(dashboard => {
      logViewActions.push({
        group: 'Dashboards',
        icon: <i className="bi bi-grid-1x2" />,
        title: dashboard.name,
        keywords: ['dashboard'],
        onTrigger: () => {
          router.push(`/dashboards/${dashboard._id}`);
        },
      });
    });

    logViewActions.push(
      {
        group: 'Menu',
        icon: <i className="bi bi-layout-text-sidebar-reverse" />,
        title: 'Search',
        description: 'Start a new search',
        keywords: ['log', 'events', 'logs'],
        onTrigger: () => {
          router.push('/search');
        },
      },
      {
        group: 'Menu',
        icon: <i className="bi bi-graph-up" />,
        title: 'Chart Explorer',
        description: 'Explore your data',
        keywords: ['graph', 'metrics'],
        onTrigger: () => {
          router.push('/chart');
        },
      },
      {
        group: 'Menu',
        icon: <i className="bi bi-grid-1x2" />,
        title: 'New Dashboard',
        description: 'Create a new dashboard',
        keywords: ['graph'],
        onTrigger: () => {
          router.push('/dashboards');
        },
      },
      {
        group: 'Menu',
        icon: <i className="bi bi-laptop" />,
        title: 'Client Sessions',
        description: 'View client sessions',
        keywords: ['browser', 'web'],
        onTrigger: () => {
          router.push('/sessions');
        },
      },
      {
        group: 'Menu',
        icon: <i className="bi bi-bell" />,
        title: 'Alerts',
        description: 'View and manage alerts',
        onTrigger: () => {
          router.push('/alerts');
        },
      },
      ...(SERVICE_DASHBOARD_ENABLED
        ? [
            {
              group: 'Menu',
              title: 'Service Health',
              icon: <i className="bi bi-heart-pulse" />,
              description: 'HTTP, Database and Infrastructure metrics',
              onTrigger: () => {
                router.push('/services');
              },
            },
          ]
        : []),
      {
        group: 'Menu',
        icon: <i className="bi bi-gear" />,
        title: 'Team Settings',

        onTrigger: () => {
          router.push('/team');
        },
      },
      {
        group: 'Menu',
        icon: <i className="bi bi-question-circle" />,
        title: 'Documentation',
        keywords: ['help', 'docs'],
        onTrigger: () => {
          router.push('https://www.hyperdx.io/docs');
        },
      },
      {
        group: 'Menu',
        icon: <Logo />,
        title: 'HyperDX Cloud',
        description: 'Ready to use HyperDX Cloud? Get started for free.',
        keywords: ['account', 'profile'],
        onTrigger: () => {
          router.push('https://hyperdx.io/register');
        },
      },
    );

    return logViewActions;
  }, [logViewsData, dashboardsData, router]);

  return { actions };
};

export const HDXSpotlightProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { actions } = useSpotlightActions();

  return (
    <SpotlightProvider
      shortcut="mod + K"
      searchPlaceholder="Search"
      searchIcon={<i className="bi bi-search" />}
      nothingFoundMessage="Nothing found"
      zIndex={200001} // above the autocomplete
      tagsToIgnore={[]}
      highlightQuery
      actions={actions}
    >
      {children}
    </SpotlightProvider>
  );
};
