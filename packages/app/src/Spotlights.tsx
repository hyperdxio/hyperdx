import * as React from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
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
import { IS_K8S_DASHBOARD_ENABLED } from './config';
import { useDashboards } from './dashboard';
import { useSavedSearches } from './savedSearch';

import '@mantine/spotlight/styles.css';

export const useSpotlightActions = () => {
  const { t } = useTranslation('navigation');
  const router = useRouter();
  const brandName = useBrandDisplayName();
  const logomark = useLogomark({ size: 16 });

  const { data: logViewsData } = useSavedSearches();
  const { data: dashboardsData } = useDashboards();

  const actions = React.useMemo<SpotlightActionData[]>(() => {
    const logViews = logViewsData ?? [];
    const dashboards = dashboardsData ?? [];

    const logViewActions: SpotlightActionData[] = [];

    // Saved searches
    logViews.forEach(logView => {
      logViewActions.push({
        id: logView.id,
        group: t('spotlight.groups.savedSearches'),
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
        group: t('spotlight.groups.dashboards'),
        leftSection: <IconLayout size={16} />,
        label: dashboard.name,
        keywords: ['dashboard'],
        onClick: () => {
          router.push(`/dashboards/${dashboard.id}`);
        },
      });
    });

    // Preset dashboards
    const presetDashboards = [
      {
        id: 'preset-services',
        label: t('links.services'),
        description: t('spotlight.servicesDescription'),
        href: '/services',
        keywords: ['preset', 'dashboard', 'http', 'latency', 'errors'],
      },
      {
        id: 'preset-clickhouse',
        label: t('links.clickhouse'),
        description: t('spotlight.clickhouseDescription'),
        href: '/clickhouse',
        keywords: ['preset', 'dashboard', 'database', 'queries'],
      },
      ...(IS_K8S_DASHBOARD_ENABLED
        ? [
            {
              id: 'preset-kubernetes',
              label: t('links.kubernetes'),
              description: t('spotlight.kubernetesDescription'),
              href: '/kubernetes',
              keywords: ['preset', 'dashboard', 'k8s', 'pods', 'cluster'],
            },
          ]
        : []),
    ];

    presetDashboards.forEach(preset => {
      logViewActions.push({
        id: preset.id,
        group: t('spotlight.groups.presetDashboards'),
        leftSection: <IconLayout size={16} />,
        label: preset.label,
        description: preset.description,
        keywords: preset.keywords,
        onClick: () => {
          router.push(preset.href);
        },
      });
    });

    logViewActions.push(
      {
        id: 'search',
        group: t('spotlight.groups.menu'),
        leftSection: <IconLogs size={16} />,
        label: t('links.search'),
        description: t('spotlight.searchDescription'),
        keywords: ['log', 'events', 'logs'],
        onClick: () => {
          router.push('/search');
        },
      },
      {
        id: 'chart-explorer',
        group: t('spotlight.groups.menu'),
        leftSection: <IconChartLine size={16} />,
        label: t('links.chartExplorer'),
        description: t('spotlight.chartDescription'),
        keywords: ['graph', 'metrics'],
        onClick: () => {
          router.push('/chart');
        },
      },
      {
        id: 'new-dashboard',
        group: t('spotlight.groups.menu'),
        leftSection: <IconGridDots size={16} />,
        label: t('links.newDashboard'),
        description: t('spotlight.dashboardDescription'),
        keywords: ['graph'],
        onClick: () => {
          router.push('/dashboards');
        },
      },
      {
        id: 'sessions',
        group: t('spotlight.groups.menu'),
        leftSection: <IconDeviceLaptop size={16} />,
        label: t('links.clientSessions'),
        description: t('spotlight.sessionsDescription'),
        keywords: ['browser', 'web'],
        onClick: () => {
          router.push('/sessions');
        },
      },
      {
        id: 'alerts',
        group: t('spotlight.groups.menu'),
        leftSection: <IconBell size={16} />,
        label: t('links.alerts'),
        description: t('spotlight.alertsDescription'),
        onClick: () => {
          router.push('/alerts');
        },
      },
      {
        id: 'service-health',
        group: t('spotlight.groups.menu'),
        label: t('links.serviceHealth'),
        leftSection: <IconActivityHeartbeat size={16} />,
        description: t('spotlight.serviceHealthDescription'),
        onClick: () => {
          router.push('/services');
        },
      },
      {
        id: 'team-settings',
        group: t('spotlight.groups.menu'),
        leftSection: <IconSettings size={16} />,
        label: t('links.teamSettings'),

        onClick: () => {
          router.push('/team');
        },
      },
      {
        id: 'documentation',
        group: t('spotlight.groups.menu'),
        leftSection: <IconHelpCircle size={16} />,
        label: t('links.documentation'),
        keywords: ['help', 'docs'],
        onClick: () => {
          router.push(
            'https://clickhouse.com/docs/use-cases/observability/clickstack',
          );
        },
      },
      {
        id: 'cloud',
        group: t('spotlight.groups.menu'),
        leftSection: logomark,
        label: `${brandName} ${t('spotlight.cloud')}`,
        description: t('spotlight.cloudReady', { brandName }),
        keywords: ['account', 'profile'],
        onClick: () => {
          router.push(
            'https://clickhouse.com/docs/use-cases/observability/clickstack/getting-started#deploy-with-clickhouse-cloud',
          );
        },
      },
    );

    return logViewActions;
  }, [brandName, dashboardsData, logViewsData, logomark, router, t]);

  return { actions };
};

export const HDXSpotlightProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { t } = useTranslation('navigation');
  const { actions } = useSpotlightActions();

  return (
    <div className="notranslate" translate="no">
      {children}
      <Spotlight
        shortcut="mod + K"
        searchProps={{
          leftSection: <IconSearch size={16} />,
          placeholder: t('spotlight.searchPlaceholder'),
        }}
        nothingFound={t('spotlight.nothingFound')}
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
