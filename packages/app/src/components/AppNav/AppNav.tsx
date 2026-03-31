import { useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import Router, { useRouter } from 'next/router';
import cx from 'classnames';
import HyperDX from '@hyperdx/browser';
import { AlertState } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Badge,
  Collapse,
  Group,
  ScrollArea,
  Text,
} from '@mantine/core';
import { useDisclosure, useLocalStorage } from '@mantine/hooks';
import {
  IconArrowBarToLeft,
  IconBell,
  IconBellFilled,
  IconChartDots,
  IconDeviceFloppy,
  IconDeviceLaptop,
  IconLayoutGrid,
  IconSettings,
  IconSitemap,
  IconTable,
} from '@tabler/icons-react';

import api from '@/api';
import { IS_LOCAL_MODE } from '@/config';
import { Dashboard, useDashboards } from '@/dashboard';
import { useFavorites } from '@/favorites';
import InstallInstructionModal from '@/InstallInstructionsModal';
import OnboardingChecklist from '@/OnboardingChecklist';
import { useSavedSearches } from '@/savedSearch';
import { useLogomark, useWordmark } from '@/theme/ThemeProvider';
import type { SavedSearch } from '@/types';
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

  const { data: savedSearches } = useSavedSearches();
  const { data: dashboards } = useDashboards();
  const { data: favorites } = useFavorites();

  const favoritedSavedSearchIds = useMemo(() => {
    if (!favorites) return new Set<string>();

    return new Set(
      favorites
        .filter(f => f.resourceType === 'savedSearch')
        .map(f => f.resourceId),
    );
  }, [favorites]);

  const favoritedSavedSearches = useMemo(() => {
    if (!savedSearches) return [];

    return savedSearches
      .filter(s => favoritedSavedSearchIds.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [favoritedSavedSearchIds, savedSearches]);

  const favoritedDashboardIds = useMemo(() => {
    if (!favorites) return new Set<string>();

    return new Set(
      favorites
        .filter(f => f.resourceType === 'dashboard')
        .map(f => f.resourceId),
    );
  }, [favorites]);

  const favoritedDashboards = useMemo(() => {
    if (!dashboards) return [];

    return dashboards
      .filter(d => favoritedDashboardIds.has(d.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [dashboards, favoritedDashboardIds]);

  const [isSavedSearchExpanded, setIsSavedSearchExpanded] =
    useLocalStorage<boolean>({
      key: 'isSavedSearchExpanded',
      defaultValue: true,
    });
  const [isDashboardsExpanded, setIsDashboardsExpanded] =
    useLocalStorage<boolean>({
      key: 'isDashboardsExpanded',
      defaultValue: true,
    });

  const router = useRouter();
  const { pathname, query } = router;

  const { data: meData } = api.useMe();

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

  const renderSavedSearchLink = useCallback(
    (savedSearch: SavedSearch) => (
      <Link
        href={`/search/${savedSearch.id}`}
        key={savedSearch.id}
        tabIndex={0}
        className={cx(
          styles.subMenuItem,
          savedSearch.id === query.savedSearchId && styles.subMenuItemActive,
        )}
        title={savedSearch.name}
      >
        <Group gap={2}>
          <div className="text-truncate">{savedSearch.name}</div>
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
    [query.savedSearchId],
  );

  const renderDashboardLink = useCallback(
    (dashboard: Dashboard) => (
      <Link
        href={`/dashboards/${dashboard.id}`}
        key={dashboard.id}
        tabIndex={0}
        className={cx(styles.subMenuItem, {
          [styles.subMenuItemActive]: dashboard.id === query.dashboardId,
        })}
      >
        <div className="text-truncate">{dashboard.name}</div>
      </Link>
    ),
    [query.dashboardId],
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

  const isSavedSearchActive = useMemo(() => {
    if (!pathname?.startsWith('/search/')) return false;

    if (
      typeof query.savedSearchId === 'string' &&
      favoritedSavedSearchIds.has(query.savedSearchId)
    ) {
      return !isSavedSearchExpanded;
    }

    return true;
  }, [
    favoritedSavedSearchIds,
    isSavedSearchExpanded,
    pathname,
    query.savedSearchId,
  ]);

  const isDashboardsActive = useMemo(() => {
    const isDashboardsPathname =
      pathname?.startsWith('/dashboards/') ||
      pathname === '/services' ||
      pathname === '/clickhouse' ||
      pathname === '/kubernetes';

    if (!isDashboardsPathname) return false;

    if (
      typeof query.dashboardId === 'string' &&
      favoritedDashboardIds.has(query.dashboardId)
    ) {
      return !isDashboardsExpanded;
    }

    return true;
  }, [
    pathname,
    query.dashboardId,
    favoritedDashboardIds,
    isDashboardsExpanded,
  ]);

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
        data-testid="app-nav"
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
              variant="subtle"
              size="sm"
              className={cx(styles.collapseButton, {
                [styles.collapseButtonCollapsed]: isCollapsed,
              })}
              title="Collapse/Expand Navigation"
              onClick={() => setIsPreferCollapsed((v: boolean) => !v)}
            >
              <IconArrowBarToLeft size={16} />
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
              isActive={pathname === '/search'}
            />

            {/* Saved Searches */}
            <AppNavLink
              label="Saved Searches"
              href="/search/list"
              icon={<IconDeviceFloppy size={16} />}
              isActive={isSavedSearchActive}
              isExpanded={isSavedSearchExpanded}
              onToggle={() => setIsSavedSearchExpanded(!isSavedSearchExpanded)}
            />

            {!isCollapsed && !!favoritedSavedSearches.length && (
              <Collapse in={isSavedSearchExpanded}>
                <div className={styles.subMenu}>
                  {favoritedSavedSearches.map(renderSavedSearchLink)}
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
              href="/dashboards/list"
              icon={<IconLayoutGrid size={16} />}
              isActive={isDashboardsActive}
              isExpanded={isDashboardsExpanded}
              onToggle={() => setIsDashboardsExpanded(!isDashboardsExpanded)}
            />

            {!isCollapsed && !!favoritedDashboards.length && (
              <Collapse in={isDashboardsExpanded}>
                <div className={styles.subMenu}>
                  {favoritedDashboards.map(renderDashboardLink)}
                </div>
              </Collapse>
            )}

            {/* Help */}
            <AppNavHelpMenu version={APP_VERSION} />

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
          {IS_LOCAL_MODE && !isCollapsed && (
            <Link
              href="/careers"
              style={{
                display: 'block',
                padding: '4px 16px',
                textDecoration: 'none',
                pointerEvents: 'auto',
              }}
            >
              <Text size="xs" c="dimmed">
                Join us & build the future of high scale observability &rarr;
              </Text>
            </Link>
          )}
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
