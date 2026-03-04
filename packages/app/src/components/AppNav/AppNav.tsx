import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Router, { useRouter } from 'next/router';
import cx from 'classnames';
import Fuse from 'fuse.js';
import {
  parseAsInteger,
  parseAsString,
  useQueryState,
  useQueryStates,
} from 'nuqs';
import HyperDX from '@hyperdx/browser';
import { AlertState } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Badge,
  Button,
  CloseButton,
  Collapse,
  Group,
  Input,
  Loader,
  ScrollArea,
} from '@mantine/core';
import { useDisclosure, useLocalStorage } from '@mantine/hooks';
import {
  IconBell,
  IconBellFilled,
  IconChartDots,
  IconChevronDown,
  IconChevronRight,
  IconCommand,
  IconDeviceLaptop,
  IconLayoutGrid,
  IconLayoutSidebarLeftCollapse,
  IconSearch,
  IconSettings,
  IconSitemap,
  IconTable,
} from '@tabler/icons-react';

import api from '@/api';
import { IS_K8S_DASHBOARD_ENABLED, IS_LOCAL_MODE } from '@/config';
import {
  useCreateDashboard,
  useDashboards,
  useUpdateDashboard,
} from '@/dashboard';
import InstallInstructionModal from '@/InstallInstructionsModal';
import OnboardingChecklist from '@/OnboardingChecklist';
import { useSavedSearches, useUpdateSavedSearch } from '@/savedSearch';
import { useLogomark, useWordmark } from '@/theme/ThemeProvider';
import type { SavedSearch, ServerDashboard } from '@/types';
import { UserPreferencesModal } from '@/UserPreferencesModal';
import { useUserPreferences } from '@/useUserPreferences';
import { useWindowSize } from '@/utils';

import packageJson from '../../../package.json';

import {
  AppNavCloudBanner,
  AppNavContext,
  AppNavHelpMenu,
  AppNavLink,
  AppNavUserMenu,
} from './AppNav.components';

import styles from './AppNav.module.scss';

// Expose the same value Next injected at build time; fall back to package.json for dev tooling
const APP_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION ?? packageJson.version ?? 'dev';

const UNTAGGED_SEARCHES_GROUP_NAME = 'Saved Searches';
const UNTAGGED_DASHBOARDS_GROUP_NAME = 'Saved Dashboards';

// Navigation link configuration
type NavLinkConfig = {
  id: string;
  label: string;
  href: string;
  icon: React.ReactNode;
  isBeta?: boolean;
  cloudOnly?: boolean; // Only show when not in local mode
};

const NAV_LINKS: NavLinkConfig[] = [
  {
    id: 'chart',
    label: 'Chart Explorer',
    href: '/chart',
    icon: <IconChartDots size={16} />,
  },
  {
    id: 'alerts',
    label: 'Alerts',
    href: '/alerts',
    icon: <IconBell size={16} />,
    cloudOnly: true,
  },
  {
    id: 'sessions',
    label: 'Client Sessions',
    href: '/sessions',
    icon: <IconDeviceLaptop size={16} />,
  },
  {
    id: 'service-map',
    label: 'Service Map',
    href: '/service-map',
    icon: <IconSitemap size={16} />,
    isBeta: true,
  },
];

function NewDashboardButton() {
  const createDashboard = useCreateDashboard();

  if (IS_LOCAL_MODE) {
    return (
      <Button
        component={Link}
        href="/dashboards"
        data-testid="create-dashboard-button"
        variant="transparent"
        color="var(--color-text)"
        py="0px"
        px="sm"
        fw={400}
      >
        <span className="pe-2">+</span> Create Dashboard
      </Button>
    );
  }

  return (
    <Button
      data-testid="create-dashboard-button"
      variant="transparent"
      color="var(--color-text)"
      py="0px"
      px="sm"
      fw={400}
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
      <div className={styles.shortcutHint}>
        {window.navigator.platform?.toUpperCase().includes('MAC') ? (
          <IconCommand size={8} />
        ) : (
          <span className={styles.shortcutHintCtrl}>Ctrl</span>
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
      data-testid="nav-search-input"
      placeholder={placeholder}
      value={value}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
        onChange(e.currentTarget.value)
      }
      leftSection={<IconSearch size={16} className="ps-1" />}
      onKeyDown={handleKeyDown}
      rightSection={
        value ? (
          <CloseButton
            data-testid="nav-search-clear"
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
    <div className={styles.groupLabel} onClick={onClick}>
      {collapsed ? (
        <IconChevronRight size={14} />
      ) : (
        <IconChevronDown size={14} />
      )}
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
  >({
    key: `collapsedGroups-${name}`,
    defaultValue: {},
  });

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
          className={cx(draggingOver === group.name && styles.groupDragOver)}
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
  const wordmark = useWordmark();
  const logomark = useLogomark({ size: 22 });

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
  const logViews = useMemo(() => logViewsData ?? [], [logViewsData]);

  const updateDashboard = useUpdateDashboard();
  const updateLogView = useUpdateSavedSearch();

  const {
    data: dashboardsData,
    isLoading: isDashboardsLoading,
    refetch: refetchDashboards,
  } = useDashboards();
  const dashboards = useMemo(() => dashboardsData ?? [], [dashboardsData]);

  const router = useRouter();
  const { pathname, query } = router;

  const [timeRangeQuery] = useQueryStates({
    from: parseAsInteger.withDefault(-1),
    to: parseAsInteger.withDefault(-1),
  });
  const [inputTimeQuery] = useQueryState(
    'tq',
    parseAsString.withDefault('').withOptions({ history: 'push' }),
  );

  const { data: meData } = api.useMe();

  const [isSearchExpanded, setIsSearchExpanded] = useLocalStorage<boolean>({
    key: 'isSearchExpanded',
    defaultValue: true,
  });
  const [isDashboardsExpanded, setIsDashboardExpanded] =
    useLocalStorage<boolean>({
      key: 'isDashboardsExpanded',
      defaultValue: true,
    });
  const { width } = useWindowSize();

  const [isPreferCollapsed, setIsPreferCollapsed] = useLocalStorage<boolean>({
    key: 'isNavCollapsed',
    defaultValue: false,
  });

  const isSmallScreen = (width ?? 1000) < 900;
  const isCollapsed = isSmallScreen || isPreferCollapsed;

  const navWidth = isCollapsed ? 50 : 250;

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
    useLocalStorage<boolean>({
      key: 'isDashboardsPresetsCollapsed',
      defaultValue: false,
    });

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
          styles.subMenuItem,
          savedSearch.id === query.savedSearchId && styles.subMenuItemActive,
        )}
        title={savedSearch.name}
        draggable
        data-savedsearchid={savedSearch.id}
      >
        <Group gap={2}>
          <div className="d-inline-block text-truncate">{savedSearch.name}</div>
          {Array.isArray(savedSearch.alerts) &&
          savedSearch.alerts.length > 0 ? (
            savedSearch.alerts.some(a => a.state === AlertState.ALERT) ? (
              <IconBellFilled
                size={14}
                className="float-end text-danger ms-1"
                aria-label="Has Alerts and is in ALERT state"
              />
            ) : (
              <IconBell
                size={14}
                className="float-end ms-1"
                aria-label="Has Alerts and is in OK state"
              />
            )
          ) : null}
        </Group>
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
        className={cx(styles.subMenuItem, {
          [styles.subMenuItemActive]: dashboard.id === query.dashboardId,
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
        <div
          className={styles.navGhost}
          style={{
            width: navWidth + 1,
            minWidth: navWidth + 1,
          }}
        ></div>
      )}
      <InstallInstructionModal
        show={showInstallInstructions}
        onHide={closeInstallInstructions}
      />
      <div
        className={cx(styles.nav, {
          [styles.navFixed]: fixed,
          [styles.navCollapsed]: isCollapsed,
        })}
        style={{ width: navWidth }}
      >
        <div style={{ width: navWidth }}>
          <div
            className={cx(styles.header, {
              [styles.headerExpanded]: !isCollapsed,
              [styles.headerCollapsed]: isCollapsed,
            })}
          >
            <Link href="/search" className={styles.logoLink}>
              {isCollapsed ? (
                <div className={styles.logoIconWrapper}>{logomark}</div>
              ) : (
                <Group gap="xs" align="center">
                  {wordmark}
                  {isUTC && (
                    <Badge
                      size="xs"
                      color="gray"
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
            <ActionIcon
              variant="transparent"
              size="sm"
              className={cx(styles.collapseButton, {
                [styles.collapseButtonCollapsed]: isCollapsed,
              })}
              title="Collapse/Expand Navigation"
              onClick={() => setIsPreferCollapsed((v: boolean) => !v)}
            >
              <IconLayoutSidebarLeftCollapse size={16} />
            </ActionIcon>
          </div>
        </div>
        <ScrollArea
          type="scroll"
          scrollbarSize={6}
          scrollHideDelay={100}
          classNames={styles}
          className={styles.scrollContainer}
        >
          <div style={{ width: navWidth }} className={styles.navLinks}>
            {/* Search */}
            <AppNavLink
              label="Search"
              icon={<IconTable size={16} />}
              href="/search"
              isExpanded={isSearchExpanded}
              onToggle={
                !IS_LOCAL_MODE
                  ? () => setIsSearchExpanded(!isSearchExpanded)
                  : undefined
              }
            />

            {!isCollapsed && (
              <Collapse in={isSearchExpanded}>
                <div className={styles.subMenu}>
                  {isLogViewsLoading ? (
                    <Loader variant="dots" mx="md" my="xs" size="sm" />
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
                          <div className={styles.emptyMessage}>
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
                          <div className={styles.emptyMessage}>
                            No results matching <i>{searchesListQ}</i>
                          </div>
                        ) : null}
                      </>
                    )
                  )}
                </div>
              </Collapse>
            )}
            {/* Simple nav links from config */}
            {NAV_LINKS.filter(link => !link.cloudOnly || !IS_LOCAL_MODE).map(
              link => (
                <AppNavLink
                  key={link.id}
                  label={link.label}
                  href={link.href}
                  icon={link.icon}
                  isBeta={link.isBeta}
                />
              ),
            )}

            {/* Dashboards */}
            <AppNavLink
              label="Dashboards"
              href="/dashboards"
              icon={<IconLayoutGrid size={16} />}
              isExpanded={isDashboardsExpanded}
              onToggle={() => setIsDashboardExpanded(!isDashboardsExpanded)}
            />

            {!isCollapsed && (
              <Collapse in={isDashboardsExpanded}>
                <div className={styles.subMenu}>
                  <NewDashboardButton />

                  {isDashboardsLoading ? (
                    <Loader variant="dots" mx="md" my="xs" size="sm" />
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
                          groups={groupedFilteredDashboardsList}
                          renderLink={renderDashboardLink}
                          forceExpandGroups={!!dashboardsListQ}
                          onDragEnd={handleDashboardDragEnd}
                        />

                        {dashboards.length === 0 && (
                          <div className={styles.emptyMessage}>
                            No saved dashboards
                          </div>
                        )}

                        {dashboardsListQ &&
                        filteredDashboardsList.length === 0 ? (
                          <div className={styles.emptyMessage}>
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
                      className={cx(styles.subMenuItem, {
                        [styles.subMenuItemActive]:
                          pathname.startsWith('/clickhouse'),
                      })}
                      data-testid="nav-link-clickhouse-dashboard"
                    >
                      ClickHouse
                    </Link>
                    <Link
                      href={`/services`}
                      tabIndex={0}
                      className={cx(styles.subMenuItem, {
                        [styles.subMenuItemActive]:
                          pathname.startsWith('/services'),
                      })}
                      data-testid="nav-link-services-dashboard"
                    >
                      Services
                    </Link>
                    {IS_K8S_DASHBOARD_ENABLED && (
                      <Link
                        href={`/kubernetes`}
                        tabIndex={0}
                        className={cx(styles.subMenuItem, {
                          [styles.subMenuItemActive]:
                            pathname.startsWith('/kubernetes'),
                        })}
                        data-testid="nav-link-k8s-dashboard"
                      >
                        Kubernetes
                      </Link>
                    )}
                  </Collapse>
                </div>
              </Collapse>
            )}

            {/* Team Settings (Cloud only) */}
            {!IS_LOCAL_MODE && (
              <AppNavLink
                label="Team Settings"
                href="/team"
                icon={<IconSettings size={16} />}
              />
            )}
          </div>

          {!isCollapsed && (
            <div
              style={{ width: navWidth }}
              className={styles.onboardingSection}
            >
              <OnboardingChecklist onAddDataClick={openInstallInstructions} />
              <AppNavCloudBanner />
            </div>
          )}
        </ScrollArea>

        <div className={styles.footer} style={{ width: navWidth }}>
          <AppNavHelpMenu
            version={APP_VERSION}
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
