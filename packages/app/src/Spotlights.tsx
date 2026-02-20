import * as React from 'react';
import { useRouter } from 'next/router';
import { Spotlight, SpotlightActionData } from '@mantine/spotlight';
import {
  IconActivityHeartbeat,
  IconBell,
  IconChartLine,
  IconDeviceLaptop,
  IconGridDots,
  IconHelpCircle,
  IconLayout,
  IconLogs,
  IconSearch,
  IconSettings,
} from '@tabler/icons-react';

import { useBrandDisplayName, useLogomark } from './theme/ThemeProvider';
import api from './api';
import { useSavedSearches } from './savedSearch';

import '@mantine/spotlight/styles.css';

export const useSpotlightActions = () => {
  const router = useRouter();
  const brandName = useBrandDisplayName();
  const logomark = useLogomark({ size: 16 });

  const { data: logViewsData } = useSavedSearches();
  const { data: dashboardsData } = api.useDashboards();

  const actions = React.useMemo<SpotlightActionData[]>(() => {
    const logViews = logViewsData ?? [];
    const dashboards = dashboardsData ?? [];

    const logViewActions: SpotlightActionData[] = [];

    // Saved searches
    logViews.forEach(logView => {
      logViewActions.push({
        id: logView.id,
        group: 'Saved searches',
        leftSection: <IconLogs size={16} />,
        label: logView.name,
        keywords: ['search', 'log', 'saved'],
        onClick: () => {
          router.push(`/search/${logView.id}`);
        },
      });
    });

    // Dashboards
    dashboards.forEach(dashboard => {
      logViewActions.push({
        id: dashboard.id,
        group: 'Dashboards',
        leftSection: <IconLayout size={16} />,
        label: dashboard.name,
        keywords: ['dashboard'],
        onClick: () => {
          router.push(`/dashboards/${dashboard.id}`);
        },
      });
    });

    logViewActions.push(
      {
        id: 'search',
        group: 'Menu',
        leftSection: <IconLogs size={16} />,
        label: 'Search',
        description: 'Start a new search',
        keywords: ['log', 'events', 'logs'],
        onClick: () => {
          router.push('/search');
        },
      },
      {
        id: 'chart-explorer',
        group: 'Menu',
        leftSection: <IconChartLine size={16} />,
        label: 'Chart Explorer',
        description: 'Explore your data',
        keywords: ['graph', 'metrics'],
        onClick: () => {
          router.push('/chart');
        },
      },
      {
        id: 'new-dashboard',
        group: 'Menu',
        leftSection: <IconGridDots size={16} />,
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
        leftSection: <IconDeviceLaptop size={16} />,
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
        leftSection: <IconBell size={16} />,
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
        leftSection: <IconActivityHeartbeat size={16} />,
        description: 'HTTP, Database and Infrastructure metrics',
        onClick: () => {
          router.push('/services');
        },
      },
      {
        id: 'team-settings',
        group: 'Menu',
        leftSection: <IconSettings size={16} />,
        label: 'Team Settings',

        onClick: () => {
          router.push('/team');
        },
      },
      {
        id: 'documentation',
        group: 'Menu',
        leftSection: <IconHelpCircle size={16} />,
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
        leftSection: logomark,
        label: `${brandName} Cloud`,
        description: `Ready to use ${brandName} Cloud? Get started for free.`,
        keywords: ['account', 'profile'],
        onClick: () => {
          router.push(
            'https://clickhouse.com/docs/use-cases/observability/clickstack/getting-started#deploy-with-clickhouse-cloud',
          );
        },
      },
    );

    return logViewActions;
  }, [brandName, logomark, logViewsData, dashboardsData, router]);

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
          leftSection: <IconSearch size={16} />,
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
