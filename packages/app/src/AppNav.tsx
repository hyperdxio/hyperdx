import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Router, { useRouter } from 'next/router';
import cx from 'classnames';
import Fuse from 'fuse.js';
import { Button } from 'react-bootstrap';
import {
  NumberParam,
  StringParam,
  useQueryParam,
  useQueryParams,
  withDefault,
} from 'use-query-params';
import HyperDX from '@hyperdx/browser';
import {
  ActionIcon,
  Badge,
  CloseButton,
  Collapse,
  Group,
  Input,
  Loader,
  ScrollArea,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { version } from '../package.json';
import { useUserPreferences } from '../src/useUserPreferences';

import api from './api';
import {
  AppNavCloudBanner,
  AppNavHelpMenu,
  AppNavUserMenu,
} from './AppNav.components';
import AuthLoadingBlocker from './AuthLoadingBlocker';
import { IS_LOCAL_MODE, SERVER_URL } from './config';
import Icon from './Icon';
import Logo from './Logo';
import { KubernetesFlatIcon } from './SVGIcons';
import type { Dashboard, LogView } from './types';
import { UserPreferencesModal } from './UserPreferencesModal';
import { useLocalStorage, useWindowSize } from './utils';

import styles from '../styles/AppNav.module.scss';

const UNTAGGED_SEARCHES_GROUP_NAME = 'Saved Searches';
const UNTAGGED_DASHBOARDS_GROUP_NAME = 'Saved Dashboards';

const APP_PERFORMANCE_DASHBOARD_CONFIG = {
  id: '',
  name: 'App Performance',
  charts: [
    {
      id: '1624425',
      name: 'P95 Latency by Operation',
      x: 0,
      y: 0,
      w: 8,
      h: 3,
      series: [
        {
          type: 'time',
          aggFn: 'p95',
          field: 'duration',
          where: '',
          groupBy: ['span_name'],
        },
      ],
    },
    {
      id: '401924',
      name: 'Operations with Errors',
      x: 8,
      y: 0,
      w: 4,
      h: 3,
      series: [
        {
          type: 'time',
          aggFn: 'count',
          where: 'level:err',
          groupBy: ['span_name'],
        },
      ],
    },
    {
      id: '883200',
      name: 'Count of Operations',
      x: 0,
      y: 3,
      w: 8,
      h: 3,
      series: [
        {
          type: 'time',
          aggFn: 'count',
          where: '',
          groupBy: ['span_name'],
        },
      ],
    },
  ],
};
const HTTP_SERVER_DASHBOARD_CONFIG = {
  id: '',
  name: 'HTTP Server',
  charts: [
    {
      id: '312739',
      name: 'P95 Latency by Endpoint',
      x: 0,
      y: 0,
      w: 6,
      h: 2,
      series: [
        {
          type: 'time',
          aggFn: 'p95',
          field: 'duration',
          where: 'span.kind:server',
          groupBy: ['http.route'],
        },
      ],
    },
    {
      id: '434437',
      name: 'HTTP Status Codes',
      x: 0,
      y: 2,
      w: 6,
      h: 2,
      series: [
        {
          type: 'time',
          aggFn: 'count',
          where: 'span.kind:server',
          groupBy: ['http.status_code'],
        },
      ],
    },
    {
      id: '69137',
      name: 'HTTP 4xx, 5xx',
      x: 6,
      y: 4,
      w: 6,
      h: 2,
      series: [
        {
          type: 'time',
          aggFn: 'count',
          where: 'http.status_code:>=400 span.kind:server',
          groupBy: ['http.status_code'],
        },
      ],
    },
    {
      id: '34708',
      name: 'HTTP 5xx by Endpoint',
      x: 6,
      y: 2,
      w: 6,
      h: 2,
      series: [
        {
          type: 'time',
          aggFn: 'count',
          where: 'span.kind:server http.status_code:>=500',
          groupBy: ['http.route'],
        },
      ],
    },
    {
      id: '58773',
      name: 'Request Volume by Endpoint',
      x: 6,
      y: 0,
      w: 6,
      h: 2,
      series: [
        {
          type: 'time',
          aggFn: 'count',
          where: 'span.kind:server',
          groupBy: ['http.route'],
        },
      ],
    },
  ],
};
const REDIS_DASHBOARD_CONFIG = {
  id: '',
  name: 'Redis',
  charts: [
    {
      id: '38463',
      name: 'GET Operations',
      x: 0,
      y: 0,
      w: 6,
      h: 2,
      series: [
        {
          type: 'time',
          aggFn: 'count',
          where: 'db.system:"redis" span_name:GET',
          groupBy: [],
        },
      ],
    },
    {
      id: '488836',
      name: 'P95 GET Latency',
      x: 0,
      y: 2,
      w: 6,
      h: 2,
      series: [
        {
          type: 'time',
          aggFn: 'p95',
          field: 'duration',
          where: 'db.system:"redis" span_name:GET',
          groupBy: [],
        },
      ],
    },
    {
      id: '8355753',
      name: 'SET Operations',
      x: 6,
      y: 0,
      w: 6,
      h: 2,
      series: [
        {
          type: 'time',
          aggFn: 'count',
          where: 'db.system:"redis" span_name:SET',
          groupBy: [],
        },
      ],
    },
    {
      id: '93278',
      name: 'P95 SET Latency',
      x: 6,
      y: 2,
      w: 6,
      h: 2,
      series: [
        {
          type: 'time',
          aggFn: 'p95',
          field: 'duration',
          where: 'db.system:"redis" span_name:SET',
          groupBy: [],
        },
      ],
    },
  ],
};
const MONGO_DASHBOARD_CONFIG = {
  id: '',
  name: 'MongoDB',
  charts: [
    {
      id: '98180',
      name: 'P95 Read Operation Latency by Collection',
      x: 0,
      y: 0,
      w: 6,
      h: 3,
      series: [
        {
          type: 'time',
          aggFn: 'p95',
          field: 'duration',
          where:
            'db.system:mongo (db.operation:"find" OR db.operation:"findOne" OR db.operation:"aggregate")',
          groupBy: ['db.mongodb.collection'],
        },
      ],
    },
    {
      id: '28877',
      name: 'P95 Write Operation Latency by Collection',
      x: 6,
      y: 0,
      w: 6,
      h: 3,
      series: [
        {
          type: 'time',
          aggFn: 'p95',
          field: 'duration',
          where:
            'db.system:mongo (db.operation:"insert" OR db.operation:"findOneAndUpdate" OR db.operation:"save" OR db.operation:"findAndModify")',
          groupBy: ['db.mongodb.collection'],
        },
      ],
    },
    {
      id: '9901546',
      name: 'Count of Write Operations by Collection',
      x: 6,
      y: 3,
      w: 6,
      h: 3,
      series: [
        {
          type: 'time',
          aggFn: 'count',
          where:
            'db.system:mongo (db.operation:"insert" OR db.operation:"findOneAndUpdate" OR db.operation:"save" OR db.operation:"findAndModify")',
          groupBy: ['db.mongodb.collection'],
        },
      ],
    },
    {
      id: '6894669',
      name: 'Count of Read Operations by Collection',
      x: 0,
      y: 3,
      w: 6,
      h: 3,
      series: [
        {
          type: 'time',
          aggFn: 'count',
          where:
            'db.system:mongo (db.operation:"find" OR db.operation:"findOne" OR db.operation:"aggregate")',
          groupBy: ['db.mongodb.collection'],
        },
      ],
    },
  ],
};
const HYPERDX_USAGE_DASHBOARD_CONFIG = {
  id: '',
  name: 'HyperDX Usage',
  charts: [
    {
      id: '15gykg',
      name: 'Log/Span Usage in Bytes',
      x: 0,
      y: 0,
      w: 3,
      h: 2,
      series: [
        {
          table: 'logs',
          type: 'number',
          aggFn: 'sum',
          field: 'hyperdx_event_size',
          where: '',
          groupBy: [],
          numberFormat: {
            output: 'byte',
          },
        },
      ],
    },
    {
      id: '1k5pul',
      name: 'Logs/Span Usage over Time',
      x: 3,
      y: 0,
      w: 9,
      h: 3,
      series: [
        {
          table: 'logs',
          type: 'time',
          aggFn: 'sum',
          field: 'hyperdx_event_size',
          where: '',
          groupBy: [],
          numberFormat: {
            output: 'byte',
          },
        },
      ],
    },
  ],
};

function PresetDashboardLink({
  query,
  config,
  name,
}: {
  query: any;
  config: any;
  name: string;
}) {
  return (
    <Link
      href={`/dashboards?config=${encodeURIComponent(JSON.stringify(config))}`}
      tabIndex={0}
      className={cx(styles.listLink, {
        [styles.listLinkActive]:
          query.config === JSON.stringify(config) && query.dashboardId == null,
        'text-muted-hover': query.config !== JSON.stringify(config),
      })}
    >
      {name}
    </Link>
  );
}

function PresetSearchLink({ query, name }: { query: string; name: string }) {
  const { query: routerQuery } = useRouter();
  const [searchedQuery] = useQueryParam('q', withDefault(StringParam, ''));
  const [timeRangeQuery] = useQueryParams({
    from: withDefault(NumberParam, -1),
    to: withDefault(NumberParam, -1),
  });
  const [inputTimeQuery] = useQueryParam('tq', withDefault(StringParam, ''), {
    updateType: 'pushIn',
    enableBatching: true,
  });

  return (
    <Link
      href={`/search?${new URLSearchParams(
        timeRangeQuery.from != -1 && timeRangeQuery.to != -1
          ? {
              q: query,
              from: timeRangeQuery.from.toString(),
              to: timeRangeQuery.to.toString(),
              tq: inputTimeQuery,
            }
          : {
              q: query,
            },
      ).toString()}`}
      tabIndex={0}
      className={cx(styles.listLink, {
        [styles.listLinkActive]:
          routerQuery.savedSearchId == null && searchedQuery === query,
      })}
    >
      {name}
    </Link>
  );
}

function SearchInput({
  placeholder,
  value,
  onChange,
  onEnterDown,
}: {
  placeholder: string;
  value: string;
  onChange: (arg0: string) => void;
  onEnterDown?: () => void;
}) {
  const kbdShortcut = useMemo(() => {
    return (
      <div className={styles.kbd}>
        {window.navigator.platform?.toUpperCase().includes('MAC') ? (
          <i className="bi bi-command" />
        ) : (
          <span style={{ letterSpacing: -2 }}>Ctrl</span>
        )}
        &nbsp;K
      </div>
    );
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        onEnterDown?.();
      }
    },
    [onEnterDown],
  );

  return (
    <Input
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.currentTarget.value)}
      leftSection={<i className="bi bi-search fs-8 ps-1 text-slate-400" />}
      onKeyDown={handleKeyDown}
      rightSection={
        value ? (
          <CloseButton
            tabIndex={-1}
            size="xs"
            radius="xl"
            onClick={() => onChange('')}
          />
        ) : (
          kbdShortcut
        )
      }
      mt={8}
      mb="sm"
      size="xs"
      variant="filled"
      radius="xl"
      className={styles.searchInput}
    />
  );
}

interface AppNavLinkItem {
  _id: string;
  name: string;
  tags?: string[];
}

type AppNavLinkGroup<T extends AppNavLinkItem> = {
  name: string;
  items: T[];
};

const AppNavGroupLabel = ({
  name,
  collapsed,
  onClick,
}: {
  name: string;
  collapsed: boolean;
  onClick: () => void;
}) => {
  return (
    <div className={styles.listGroupName} onClick={onClick}>
      <i className={`bi bi-chevron-${collapsed ? 'right' : 'down'}`} />
      <div>{name}</div>
    </div>
  );
};

const AppNavLinkGroups = <T extends AppNavLinkItem>({
  name,
  groups,
  renderLink,
  onDragEnd,
  forceExpandGroups = false,
}: {
  name: string;
  groups: AppNavLinkGroup<T>[];
  renderLink: (item: T) => React.ReactNode;
  onDragEnd?: (target: HTMLElement | null, newGroup: string | null) => void;
  forceExpandGroups?: boolean;
}) => {
  const [collapsedGroups, setCollapsedGroups] = useLocalStorage<
    Record<string, boolean>
  >(`collapsedGroups-${name}`, {});

  const handleToggleGroup = useCallback(
    (groupName: string) => {
      setCollapsedGroups({
        ...collapsedGroups,
        [groupName]: !collapsedGroups[groupName],
      });
    },
    [collapsedGroups, setCollapsedGroups],
  );

  const [draggingOver, setDraggingOver] = useState<string | null>(null);

  return (
    <>
      {groups.map(group => (
        <div
          key={group.name}
          className={cx(
            draggingOver === group.name && styles.listGroupDragEnter,
          )}
          onDragOver={e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDraggingOver(group.name);
          }}
          onDragEnd={e => {
            e.preventDefault();
            onDragEnd?.(e.target as HTMLElement, draggingOver);
            setDraggingOver(null);
          }}
        >
          <AppNavGroupLabel
            onClick={() => handleToggleGroup(group.name)}
            name={group.name}
            collapsed={collapsedGroups[group.name]}
          />
          <Collapse in={!collapsedGroups[group.name] || forceExpandGroups}>
            {group.items.map(item => renderLink(item))}
          </Collapse>
        </div>
      ))}
    </>
  );
};

function useSearchableList<T extends AppNavLinkItem>({
  items,
  untaggedGroupName = 'Other',
}: {
  items: T[];
  untaggedGroupName?: string;
}) {
  const fuse = useMemo(
    () =>
      new Fuse(items, {
        keys: ['name'],
        threshold: 0.2,
        ignoreLocation: true,
      }),
    [items],
  );

  const [q, setQ] = useState('');

  const filteredList = useMemo(() => {
    if (q === '') {
      return items;
    }
    return fuse.search(q).map(result => result.item);
  }, [fuse, items, q]);

  const groupedFilteredList = useMemo<AppNavLinkGroup<T>[]>(() => {
    // group by tags
    const groupedItems: Record<string, T[]> = {};
    const untaggedItems: T[] = [];
    filteredList.forEach(item => {
      if (item.tags?.length) {
        item.tags.forEach(tag => {
          groupedItems[tag] = groupedItems[tag] ?? [];
          groupedItems[tag].push(item);
        });
      } else {
        untaggedItems.push(item);
      }
    });
    if (untaggedItems.length) {
      groupedItems[untaggedGroupName] = untaggedItems;
    }
    return Object.entries(groupedItems)
      .map(([name, items]) => ({
        name,
        items,
      }))
      .sort((a, b) => {
        if (a.name === untaggedGroupName) {
          return 1;
        }
        if (b.name === untaggedGroupName) {
          return -1;
        }
        return a.name.localeCompare(b.name);
      });
  }, [filteredList, untaggedGroupName]);

  return {
    filteredList,
    groupedFilteredList,
    q,
    setQ,
  };
}

export default function AppNav({ fixed = false }: { fixed?: boolean }) {
  useEffect(() => {
    let redirectUrl;
    try {
      redirectUrl = window.sessionStorage.getItem('hdx-login-redirect-url');
    } catch (e: any) {
      console.error(e);
    }
    // conditional redirect
    if (redirectUrl) {
      // with router.push the page may be added to history
      // the browser on history back will  go back to this page and then forward again to the redirected page
      // you can prevent this behaviour using location.replace
      window.sessionStorage.removeItem('hdx-login-redirect-url');
      Router.push(redirectUrl);
    }
  }, []);

  const {
    data: logViewsData,
    isLoading: isLogViewsLoading,
    refetch: refetchLogViews,
  } = api.useLogViews();
  const logViews = logViewsData?.data ?? [];

  const updateDashboard = api.useUpdateDashboard();
  const updateLogView = api.useUpdateLogView();

  const {
    data: dashboardsData,
    isLoading: isDashboardsLoading,
    refetch: refetchDashboards,
  } = api.useDashboards();
  const dashboards = dashboardsData?.data ?? [];

  const { data: alertsData, isLoading: isAlertsLoading } = api.useAlerts();
  const alerts = alertsData?.data ?? [];

  const router = useRouter();
  const { pathname, query } = router;

  const [timeRangeQuery] = useQueryParams({
    from: withDefault(NumberParam, -1),
    to: withDefault(NumberParam, -1),
  });
  const [inputTimeQuery] = useQueryParam('tq', withDefault(StringParam, ''), {
    updateType: 'pushIn',
    enableBatching: true,
  });

  const { data: meData } = api.useMe();

  const [isSearchExpanded, setIsSearchExpanded] = useLocalStorage(
    'isSearchExpanded',
    true,
  );
  const [isDashboardsExpanded, setIsDashboardExpanded] = useLocalStorage(
    'isDashboardsExpanded',
    true,
  );
  const { width } = useWindowSize();

  const [isPreferCollapsed, setIsPreferCollapsed] = useState<
    undefined | boolean
  >(undefined);

  const isSmallScreen = (width ?? 1000) < 900;
  const isCollapsed = isPreferCollapsed ?? isSmallScreen;

  const navWidth = isCollapsed ? 50 : 230;

  useEffect(() => {
    HyperDX.addAction('user navigated', {
      route: pathname,
      query: JSON.stringify(query),
    });
  }, [pathname, query]);

  useEffect(() => {
    if (meData != null) {
      HyperDX.enableAdvancedNetworkCapture();
      HyperDX.setGlobalAttributes({
        userEmail: meData.email,
        userName: meData.name,
        teamName: meData.team.name,
      });
    }
  }, [meData]);

  const alertState =
    Array.isArray(alerts) && alerts.length > 0
      ? alerts.some(a => a.state === 'ALERT')
        ? 'alarming' // Some alerts are firing
        : 'ok' // All alerts are green
      : 'none'; // No alerts are set up

  const {
    q: searchesListQ,
    setQ: setSearchesListQ,
    filteredList: filteredSearchesList,
    groupedFilteredList: groupedFilteredSearchesList,
  } = useSearchableList({
    items: logViews,
    untaggedGroupName: UNTAGGED_SEARCHES_GROUP_NAME,
  });

  const [isSearchPresetsCollapsed, setSearchPresetsCollapsed] = useLocalStorage(
    'isSearchPresetsCollapsed',
    false,
  );

  const {
    q: dashboardsListQ,
    setQ: setDashboardsListQ,
    filteredList: filteredDashboardsList,
    groupedFilteredList: groupedFilteredDashboardsList,
  } = useSearchableList({
    items: dashboards,
    untaggedGroupName: UNTAGGED_DASHBOARDS_GROUP_NAME,
  });

  const [isDashboardsPresetsCollapsed, setDashboardsPresetsCollapsed] =
    useLocalStorage('isDashboardsPresetsCollapsed', false);

  const savedSearchesResultsRef = useRef<HTMLDivElement>(null);
  const dashboardsResultsRef = useRef<HTMLDivElement>(null);

  const renderLogViewLink = useCallback(
    (lv: LogView) => (
      <Link
        href={`/search/${lv._id}?${new URLSearchParams(
          timeRangeQuery.from != -1 && timeRangeQuery.to != -1
            ? {
                from: timeRangeQuery.from.toString(),
                to: timeRangeQuery.to.toString(),
                tq: inputTimeQuery,
              }
            : {},
        ).toString()}`}
        key={lv._id}
        tabIndex={0}
        className={cx(
          styles.listLink,
          lv._id === query.savedSearchId && styles.listLinkActive,
        )}
        title={lv.name}
        draggable
        data-savedsearchid={lv._id}
      >
        <div className="d-inline-block text-truncate">{lv.name}</div>
        {Array.isArray(lv.alerts) && lv.alerts.length > 0 ? (
          lv.alerts.some(a => a.state === 'ALERT') ? (
            <i
              className="bi bi-bell float-end text-danger"
              title="Has Alerts and is in ALERT state"
            ></i>
          ) : (
            <i
              className="bi bi-bell float-end"
              title="Has Alerts and is in OK state"
            ></i>
          )
        ) : null}
      </Link>
    ),
    [
      inputTimeQuery,
      query.savedSearchId,
      timeRangeQuery.from,
      timeRangeQuery.to,
    ],
  );

  const handleLogViewDragEnd = useCallback(
    (target: HTMLElement | null, name: string | null) => {
      if (!target?.dataset.savedsearchid || name == null) {
        return;
      }
      const logView = logViews.find(
        lv => lv._id === target.dataset.savedsearchid,
      );
      if (logView?.tags?.includes(name)) {
        return;
      }
      updateLogView.mutate(
        {
          id: target.dataset.savedsearchid,
          tags: name === UNTAGGED_SEARCHES_GROUP_NAME ? [] : [name],
        },
        {
          onSuccess: () => {
            refetchLogViews();
          },
        },
      );
    },
    [logViews, refetchLogViews, updateLogView],
  );

  const renderDashboardLink = useCallback(
    (dashboard: Dashboard) => (
      <Link
        href={`/dashboards/${dashboard._id}`}
        key={dashboard._id}
        tabIndex={0}
        className={cx(styles.listLink, {
          [styles.listLinkActive]: dashboard._id === query.dashboardId,
        })}
        draggable
        data-dashboardid={dashboard._id}
      >
        {dashboard.name}
      </Link>
    ),
    [query.dashboardId],
  );

  const handleDashboardDragEnd = useCallback(
    (target: HTMLElement | null, name: string | null) => {
      if (!target?.dataset.dashboardid || name == null) {
        return;
      }
      const dashboard = dashboards.find(
        d => d._id === target.dataset.dashboardid,
      );
      if (dashboard?.tags?.includes(name)) {
        return;
      }
      updateDashboard.mutate(
        {
          id: target.dataset.dashboardid,
          tags: name === UNTAGGED_DASHBOARDS_GROUP_NAME ? [] : [name],
        },
        {
          onSuccess: () => {
            refetchDashboards();
          },
        },
      );
    },
    [dashboards, refetchDashboards, updateDashboard],
  );

  const [
    UserPreferencesOpen,
    { close: closeUserPreferences, open: openUserPreferences },
  ] = useDisclosure(false);

  const {
    userPreferences: { isUTC },
  } = useUserPreferences();

  return (
    <>
      <AuthLoadingBlocker />
      {fixed && (
        <div style={{ width: navWidth + 1, minWidth: navWidth + 1 }}></div>
      )}
      <div
        className={styles.wrapper}
        style={{
          position: fixed ? 'fixed' : 'initial',
        }}
      >
        <div style={{ width: navWidth }}>
          <div className="p-3 d-flex flex-wrap justify-content-between align-items-center">
            <Link href="/search" className="text-decoration-none">
              {isCollapsed ? (
                <div style={{ marginLeft: '-0.15rem' }}>
                  <Icon size={22} />
                </div>
              ) : (
                <Group gap="xs" align="center">
                  <Logo />
                  {isUTC && (
                    <Badge
                      size="xs"
                      color="gray"
                      bg="gray.8"
                      variant="light"
                      fw="normal"
                      title="Showing time in UTC"
                    >
                      UTC
                    </Badge>
                  )}
                </Group>
              )}
            </Link>
            <Button
              variant="dark"
              size="sm"
              className={isCollapsed ? 'mt-4' : ''}
              style={isCollapsed ? { marginLeft: '-0.5rem' } : {}}
              title="Collapse/Expand Navigation"
              onClick={() => setIsPreferCollapsed(v => !v)}
            >
              <i className="bi bi-arrows-angle-expand"></i>
            </Button>
          </div>
        </div>
        <ScrollArea
          type="scroll"
          scrollbarSize={6}
          scrollHideDelay={100}
          style={{
            maxHeight: '100%',
            height: '100%',
          }}
          classNames={styles}
          className="d-flex flex-column justify-content-between"
        >
          <div style={{ width: navWidth }}>
            <div className="mt-2">
              <div className="px-3 d-flex align-items-center justify-content-between mb-2">
                <Link
                  href="/search"
                  className={cx(
                    'text-decoration-none d-flex justify-content-between align-items-center fs-7 text-muted-hover',
                    {
                      'text-success fw-bold':
                        pathname.includes('/search') &&
                        query.savedSearchId == null,
                      'fw-bold':
                        pathname.includes('/search') &&
                        query.savedSearchId != null,
                    },
                  )}
                >
                  <span>
                    <i className="bi bi-layout-text-sidebar-reverse pe-1 text-slate-300" />{' '}
                    {!isCollapsed && <span>Search</span>}
                  </span>
                </Link>
                {!isCollapsed && (
                  <ActionIcon
                    variant="default"
                    size="sm"
                    onClick={() => {
                      setIsSearchExpanded(!isSearchExpanded);
                    }}
                  >
                    <i
                      className={`fs-8 bi bi-chevron-${
                        isSearchExpanded ? 'up' : 'down'
                      } text-muted-hover`}
                    />
                  </ActionIcon>
                )}
              </div>
              {!isCollapsed && (
                <Collapse in={isSearchExpanded}>
                  <div className={styles.list}>
                    {isLogViewsLoading ? (
                      <Loader
                        color="gray.7"
                        variant="dots"
                        mx="md"
                        my="xs"
                        size="sm"
                      />
                    ) : (
                      <>
                        <SearchInput
                          placeholder="Saved Searches"
                          value={searchesListQ}
                          onChange={setSearchesListQ}
                          onEnterDown={() => {
                            (
                              savedSearchesResultsRef?.current
                                ?.firstChild as HTMLAnchorElement
                            )?.focus?.();
                          }}
                        />

                        {logViews.length === 0 && (
                          <div className={styles.listEmptyMsg}>
                            No saved searches
                          </div>
                        )}
                        <div ref={savedSearchesResultsRef}>
                          <AppNavLinkGroups
                            name="saved-searches"
                            groups={groupedFilteredSearchesList}
                            renderLink={renderLogViewLink}
                            forceExpandGroups={!!searchesListQ}
                            onDragEnd={handleLogViewDragEnd}
                          />
                        </div>

                        {searchesListQ && filteredSearchesList.length === 0 ? (
                          <div className={styles.listEmptyMsg}>
                            No results matching <i>{searchesListQ}</i>
                          </div>
                        ) : null}
                      </>
                    )}
                    <AppNavGroupLabel
                      name="Presets"
                      collapsed={isSearchPresetsCollapsed}
                      onClick={() =>
                        setSearchPresetsCollapsed(!isSearchPresetsCollapsed)
                      }
                    />
                    <Collapse in={!isSearchPresetsCollapsed}>
                      <PresetSearchLink
                        query="level:err OR level:crit OR level:fatal OR level:emerg OR level:alert"
                        name="All Error Events"
                      />
                      <PresetSearchLink
                        query="http.status_code:>=400"
                        name="HTTP Status >= 400"
                      />
                    </Collapse>
                  </div>
                </Collapse>
              )}
              <div className="px-3 my-3">
                <Link
                  href="/chart"
                  className={cx(
                    'text-decoration-none d-flex justify-content-between align-items-center fs-7 text-muted-hover',
                    {
                      'fw-bold text-success': pathname.includes('/chart'),
                    },
                  )}
                >
                  <span>
                    <i className="bi bi-graph-up pe-1 text-slate-300" />{' '}
                    {!isCollapsed && <span>Chart Explorer</span>}
                  </span>
                </Link>
              </div>
              <div className="px-3 my-3">
                <Link
                  href="/sessions"
                  className={cx(
                    'text-decoration-none d-flex justify-content-between align-items-center fs-7 text-muted-hover',
                    {
                      'fw-bold text-success': pathname.includes('/sessions'),
                    },
                  )}
                >
                  <span>
                    <i className="bi bi-laptop pe-1 text-slate-300" />{' '}
                    {!isCollapsed && <span>Client Sessions</span>}
                  </span>
                </Link>
              </div>
              <div className="px-3 my-3">
                <Link
                  href="/alerts"
                  className={cx(
                    'text-decoration-none d-flex justify-content-between align-items-center fs-7 text-muted-hover',
                    {
                      'fw-bold text-success': pathname.includes('/alerts'),
                    },
                  )}
                >
                  <div>
                    <i className="bi bi-bell pe-1 text-slate-300" />{' '}
                    {!isCollapsed && (
                      <div className="d-inline-flex align-items-center">
                        <span>Alerts</span>
                        <div
                          className="ms-3"
                          style={{
                            borderRadius: 8,
                            background:
                              alertState == 'alarming'
                                ? '#e74c3c'
                                : alertState === 'ok'
                                ? '#00d474'
                                : 'gray',
                            height: 8,
                            width: 8,
                          }}
                          title={
                            alertState === 'alarming'
                              ? 'Some alerts are firing'
                              : alertState === 'ok'
                              ? 'All alerts are ok'
                              : 'No alerts are set up'
                          }
                        ></div>
                      </div>
                    )}
                  </div>
                </Link>
              </div>

              <div className="px-3 my-3">
                <Link
                  href="/services"
                  className={cx(
                    'text-decoration-none d-flex justify-content-between align-items-center fs-7 text-muted-hover',
                    {
                      'fw-bold text-success': pathname.includes('/services'),
                    },
                  )}
                >
                  <span>
                    <i className="bi bi-heart-pulse pe-1 text-slate-300" />{' '}
                    {!isCollapsed && <span>Service Health</span>}
                  </span>
                </Link>
              </div>

              <div className="px-3 my-3">
                <Link
                  href="/kubernetes"
                  className={cx(
                    'text-decoration-none d-flex justify-content-between align-items-center fs-7 text-muted-hover',
                    {
                      'fw-bold text-success': pathname.includes('/kubernetes'),
                    },
                  )}
                >
                  <span>
                    <span
                      className="pe-1 text-slate-300"
                      style={{ top: -2, position: 'relative' }}
                    >
                      <KubernetesFlatIcon width={16} />
                    </span>{' '}
                    {!isCollapsed && <span>Kubernetes</span>}
                  </span>
                </Link>
              </div>

              <div>
                <div
                  className={cx(
                    'px-3 text-decoration-none d-flex justify-content-between align-items-center fs-7 text-muted mb-2',
                    {
                      'fw-bold': pathname.includes('/dashboard'),
                    },
                  )}
                >
                  <Link
                    href="/dashboards"
                    className="text-decoration-none d-flex justify-content-between align-items-center fs-7 text-muted-hover"
                  >
                    <span>
                      <i className="bi bi-grid-1x2 pe-1 text-slate-300" />{' '}
                      {!isCollapsed && <span>Dashboards</span>}
                    </span>
                  </Link>
                  {!isCollapsed && (
                    <ActionIcon
                      variant="default"
                      size="sm"
                      onClick={() => {
                        setIsDashboardExpanded(!isDashboardsExpanded);
                      }}
                    >
                      <i
                        className={`fs-8 bi bi-chevron-${
                          isDashboardsExpanded ? 'up' : 'down'
                        } text-muted-hover`}
                      />
                    </ActionIcon>
                  )}
                </div>
              </div>

              {!isCollapsed && (
                <Collapse in={isDashboardsExpanded}>
                  <div className={styles.list}>
                    <Link
                      href="/dashboards"
                      className={cx(
                        styles.listLink,
                        pathname.includes('/dashboard') &&
                          query.dashboardId == null &&
                          query.config !=
                            JSON.stringify(APP_PERFORMANCE_DASHBOARD_CONFIG) &&
                          query.config !=
                            JSON.stringify(HTTP_SERVER_DASHBOARD_CONFIG) &&
                          query.config !=
                            JSON.stringify(REDIS_DASHBOARD_CONFIG) &&
                          query.config != JSON.stringify(MONGO_DASHBOARD_CONFIG)
                          ? [styles.listLinkActive]
                          : null,
                      )}
                    >
                      <div className="mt-1 lh-1 py-1">
                        <i className="bi bi-plus-lg me-2" />
                        New Dashboard
                      </div>
                    </Link>

                    {isDashboardsLoading ? (
                      <Loader
                        color="gray.7"
                        variant="dots"
                        mx="md"
                        my="xs"
                        size="sm"
                      />
                    ) : (
                      <>
                        <SearchInput
                          placeholder="Saved Dashboards"
                          value={dashboardsListQ}
                          onChange={setDashboardsListQ}
                          onEnterDown={() => {
                            (
                              dashboardsResultsRef?.current
                                ?.firstChild as HTMLAnchorElement
                            )?.focus?.();
                          }}
                        />

                        <AppNavLinkGroups
                          name="dashboards"
                          groups={groupedFilteredDashboardsList}
                          renderLink={renderDashboardLink}
                          forceExpandGroups={!!dashboardsListQ}
                          onDragEnd={handleDashboardDragEnd}
                        />

                        {dashboards.length === 0 && (
                          <div className={styles.listEmptyMsg}>
                            No saved dashboards
                          </div>
                        )}

                        {dashboardsListQ &&
                        filteredDashboardsList.length === 0 ? (
                          <div className={styles.listEmptyMsg}>
                            No results matching <i>{dashboardsListQ}</i>
                          </div>
                        ) : null}
                      </>
                    )}

                    <AppNavGroupLabel
                      name="Presets"
                      collapsed={isDashboardsPresetsCollapsed}
                      onClick={() =>
                        setDashboardsPresetsCollapsed(
                          !isDashboardsPresetsCollapsed,
                        )
                      }
                    />
                    <Collapse in={!isDashboardsPresetsCollapsed}>
                      <PresetDashboardLink
                        query={query}
                        config={HYPERDX_USAGE_DASHBOARD_CONFIG}
                        name="HyperDX Usage"
                      />
                      <PresetDashboardLink
                        query={query}
                        config={APP_PERFORMANCE_DASHBOARD_CONFIG}
                        name="App Performance"
                      />
                      <PresetDashboardLink
                        query={query}
                        config={HTTP_SERVER_DASHBOARD_CONFIG}
                        name="HTTP Server"
                      />
                      <PresetDashboardLink
                        query={query}
                        config={REDIS_DASHBOARD_CONFIG}
                        name="Redis"
                      />
                      <PresetDashboardLink
                        query={query}
                        config={MONGO_DASHBOARD_CONFIG}
                        name="Mongo"
                      />
                    </Collapse>
                  </div>
                </Collapse>
              )}

              <div className="px-3 my-3">
                <Link
                  href="/team"
                  className={cx(
                    'text-decoration-none d-flex justify-content-between align-items-center fs-7 text-muted-hover',
                    {
                      'fw-bold text-success': pathname.includes('/team'),
                    },
                  )}
                >
                  <span>
                    <i className="bi bi-gear pe-1 text-slate-300" />{' '}
                    {!isCollapsed && <span>Team Settings</span>}
                  </span>
                </Link>
              </div>
            </div>
          </div>
          {!isCollapsed && (
            <>
              <div
                style={{ width: navWidth, paddingBottom: 80 }}
                className="px-3 mb-2 mt-4"
              >
                <AppNavCloudBanner />
              </div>
            </>
          )}
        </ScrollArea>

        <div
          style={{
            width: navWidth,
            position: 'absolute',
            bottom: 0,
            pointerEvents: 'none',
          }}
        >
          <AppNavHelpMenu isCollapsed={isCollapsed} version={version} />
          <AppNavUserMenu
            userName={meData?.name}
            teamName={meData?.team?.name}
            isCollapsed={isCollapsed}
            onClickUserPreferences={openUserPreferences}
            logoutUrl={IS_LOCAL_MODE ? null : `${SERVER_URL}/logout`}
          />
        </div>
      </div>
      <UserPreferencesModal
        opened={UserPreferencesOpen}
        onClose={closeUserPreferences}
      />
    </>
  );
}
