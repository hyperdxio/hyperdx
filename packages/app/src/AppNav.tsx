import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Router, { useRouter } from 'next/router';
import cx from 'classnames';
import Fuse from 'fuse.js';
import {
  NumberParam,
  StringParam,
  useQueryParam,
  useQueryParams,
  withDefault,
} from 'use-query-params';
import HyperDX from '@hyperdx/browser';
import { AlertState } from '@hyperdx/common-utils/dist/types';
import {
  Badge,
  Box,
  Button,
  CloseButton,
  Collapse,
  Group,
  Input,
  Loader,
  ScrollArea,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import {
  useCreateDashboard,
  useDashboards,
  useUpdateDashboard,
} from '@/dashboard';
import { useUserPreferences } from '@/useUserPreferences';

import { version } from '../package.json';

import api from './api';
import {
  AppNavCloudBanner,
  AppNavContext,
  AppNavHelpMenu,
  AppNavLink,
  AppNavUserMenu,
} from './AppNav.components';
import { IS_K8S_DASHBOARD_ENABLED, IS_LOCAL_MODE } from './config';
import Icon from './Icon';
import InstallInstructionModal from './InstallInstructionsModal';
import Logo from './Logo';
import OnboardingChecklist from './OnboardingChecklist';
import { useSavedSearches, useUpdateSavedSearch } from './savedSearch';
import type { SavedSearch, ServerDashboard } from './types';
import { UserPreferencesModal } from './UserPreferencesModal';
import { useLocalStorage, useWindowSize } from './utils';

import styles from '../styles/AppNav.module.scss';

const UNTAGGED_SEARCHES_GROUP_NAME = 'Saved Searches';
const UNTAGGED_DASHBOARDS_GROUP_NAME = 'Saved Dashboards';

function NewDashboardButton() {
  const createDashboard = useCreateDashboard();

  if (IS_LOCAL_MODE) {
    return (
      <Link href="/dashboards">
        <Button variant="transparent" py="0px" px="sm" fw={400} color="gray.2">
          <span className="pe-2">+</span> Create Dashboard
        </Button>
      </Link>
    );
  }

  return (
    <Button
      variant="transparent"
      py="0px"
      px="sm"
      fw={400}
      color="gray.2"
      onClick={() =>
        createDashboard.mutate(
          {
            name: 'My Dashboard',
            tiles: [],
            tags: [],
          },
          {
            onSuccess: data => {
              Router.push(`/dashboards/${data.id}`);
            },
          },
        )
      }
    >
      <span className="pe-2">+</span> Create Dashboard
    </Button>
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
  id: string;
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
  } = useSavedSearches();
  const logViews = logViewsData ?? [];

  const updateDashboard = useUpdateDashboard();
  const updateLogView = useUpdateSavedSearch();

  const {
    data: dashboardsData,
    isLoading: isDashboardsLoading,
    refetch: refetchDashboards,
  } = useDashboards();
  const dashboards = dashboardsData ?? [];

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

  const [isPreferCollapsed, setIsPreferCollapsed] = useLocalStorage<boolean>(
    'isNavCollapsed',
    false,
  );

  const isSmallScreen = (width ?? 1000) < 900;
  const isCollapsed = isSmallScreen || isPreferCollapsed;

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

  const {
    q: searchesListQ,
    setQ: setSearchesListQ,
    filteredList: filteredSearchesList,
    groupedFilteredList: groupedFilteredSearchesList,
  } = useSearchableList({
    items: logViews,
    untaggedGroupName: UNTAGGED_SEARCHES_GROUP_NAME,
  });

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
    (savedSearch: SavedSearch) => (
      <Link
        href={`/search/${savedSearch.id}?${new URLSearchParams(
          timeRangeQuery.from != -1 && timeRangeQuery.to != -1
            ? {
                from: timeRangeQuery.from.toString(),
                to: timeRangeQuery.to.toString(),
                tq: inputTimeQuery,
              }
            : {},
        ).toString()}`}
        key={savedSearch.id}
        tabIndex={0}
        className={cx(
          styles.listLink,
          savedSearch.id === query.savedSearchId && styles.listLinkActive,
        )}
        title={savedSearch.name}
        draggable
        data-savedsearchid={savedSearch.id}
      >
        <div className="d-inline-block text-truncate">{savedSearch.name}</div>
        {Array.isArray(savedSearch.alerts) && savedSearch.alerts.length > 0 ? (
          savedSearch.alerts.some(a => a.state === AlertState.ALERT) ? (
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
        lv => lv.id === target.dataset.savedsearchid,
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
    (dashboard: ServerDashboard) => (
      <Link
        href={`/dashboards/${dashboard.id}`}
        key={dashboard.id}
        tabIndex={0}
        className={cx(styles.listLink, {
          [styles.listLinkActive]: dashboard.id === query.dashboardId,
        })}
        draggable
        data-dashboardid={dashboard.id}
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
        d => d.id === target.dataset.dashboardid,
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

  const [
    showInstallInstructions,
    { open: openInstallInstructions, close: closeInstallInstructions },
  ] = useDisclosure(false);

  return (
    <AppNavContext.Provider value={{ isCollapsed, pathname }}>
      {fixed && (
        <div style={{ width: navWidth + 1, minWidth: navWidth + 1 }}></div>
      )}
      <InstallInstructionModal
        show={showInstallInstructions}
        onHide={closeInstallInstructions}
      />
      <div
        className={`${styles.wrapper} inter`}
        style={{
          position: fixed ? 'fixed' : 'initial',
          letterSpacing: '0.05em',
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
              variant="subtle"
              color="gray.4"
              p={isCollapsed ? '0px' : '8px'}
              h="32px"
              size="md"
              className={isCollapsed ? 'mt-4' : ''}
              style={{ marginRight: -4 }}
              title="Collapse/Expand Navigation"
              onClick={() => setIsPreferCollapsed((v: boolean) => !v)}
            >
              <i className="bi bi-layout-sidebar"></i>
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
              <AppNavLink
                label="Search"
                iconName="bi-layout-text-sidebar-reverse"
                href="/search"
                className={cx({
                  'text-success fw-600':
                    pathname.includes('/search') && query.savedSearchId == null,
                  'fw-600':
                    pathname.includes('/search') && query.savedSearchId != null,
                })}
                isExpanded={isSearchExpanded}
                onToggle={
                  !IS_LOCAL_MODE
                    ? () => setIsSearchExpanded(!isSearchExpanded)
                    : undefined
                }
              />

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
                      !IS_LOCAL_MODE && (
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

                          {searchesListQ &&
                          filteredSearchesList.length === 0 ? (
                            <div className={styles.listEmptyMsg}>
                              No results matching <i>{searchesListQ}</i>
                            </div>
                          ) : null}
                        </>
                      )
                    )}
                  </div>
                </Collapse>
              )}
              <AppNavLink
                label="Chart Explorer"
                href="/chart"
                iconName="bi-graph-up"
              />
              {!IS_LOCAL_MODE && (
                <AppNavLink label="Alerts" href="/alerts" iconName="bi-bell" />
              )}
              <AppNavLink
                label="Client Sessions"
                href="/sessions"
                iconName="bi-laptop"
              />

              <AppNavLink
                label="Dashboards"
                href="/dashboards"
                iconName="bi-grid-1x2"
                isExpanded={isDashboardsExpanded}
                onToggle={() => setIsDashboardExpanded(!isDashboardsExpanded)}
              />

              {!isCollapsed && (
                <Collapse in={isDashboardsExpanded}>
                  <div className={styles.list}>
                    <NewDashboardButton />

                    {isDashboardsLoading ? (
                      <Loader
                        color="gray.7"
                        variant="dots"
                        mx="md"
                        my="xs"
                        size="sm"
                      />
                    ) : (
                      !IS_LOCAL_MODE && (
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
                            /* @ts-ignore */
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
                      )
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
                      <Link
                        href={`/clickhouse`}
                        tabIndex={0}
                        className={cx(styles.listLink, {
                          [styles.listLinkActive]:
                            pathname.startsWith('/clickhouse'),
                        })}
                      >
                        ClickHouse
                      </Link>
                      <Link
                        href={`/services`}
                        tabIndex={0}
                        className={cx(styles.listLink, {
                          [styles.listLinkActive]:
                            pathname.startsWith('/services'),
                        })}
                      >
                        Services
                      </Link>
                      {IS_K8S_DASHBOARD_ENABLED && (
                        <Link
                          href={`/kubernetes`}
                          tabIndex={0}
                          className={cx(styles.listLink, {
                            [styles.listLinkActive]:
                              pathname.startsWith('/kubernetes'),
                          })}
                        >
                          Kubernetes
                        </Link>
                      )}
                    </Collapse>
                  </div>
                </Collapse>
              )}

              {!IS_LOCAL_MODE && (
                <Box mt="sm">
                  <AppNavLink
                    label="Team Settings"
                    href="/team"
                    iconName="bi-gear"
                  />
                </Box>
              )}
            </div>
          </div>
          {!isCollapsed && (
            <>
              <div
                style={{ width: navWidth, paddingBottom: 80 }}
                className="px-3 mb-2 mt-4"
              >
                <OnboardingChecklist onAddDataClick={openInstallInstructions} />
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
          <AppNavHelpMenu
            version={version}
            onAddDataClick={openInstallInstructions}
          />
          <AppNavUserMenu
            userName={meData?.name}
            teamName={meData?.team?.name}
            onClickUserPreferences={openUserPreferences}
            logoutUrl={IS_LOCAL_MODE ? null : `/api/logout`}
          />
          {meData && meData.usageStatsEnabled && (
            <img
              referrerPolicy="no-referrer-when-downgrade"
              src="https://static.scarf.sh/a.png?x-pxid=bbc99c42-7a75-4eee-9fb9-2b161fc4acd6"
            />
          )}
        </div>
      </div>
      <UserPreferencesModal
        opened={UserPreferencesOpen}
        onClose={closeUserPreferences}
      />
    </AppNavContext.Provider>
  );
}
