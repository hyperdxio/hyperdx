import { useCallback, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import Router, { useRouter } from 'next/router';
import Script from 'next/script';
import cx from 'classnames';
import { Badge } from '@clickhouse/click-ui';
import { setAttributes, setUser } from '@clickhouse/clickstack-browser';
import { SavedSearchListApiResponse } from '@hyperdx/common-utils/dist/types';
import { Anchor, Collapse, Flex, Group, ScrollArea, Text } from '@mantine/core';
import { useDisclosure, useFocusTrap, useLocalStorage } from '@mantine/hooks';
import {
  IconBell,
  IconChartDots,
  IconDeviceFloppy,
  IconDeviceLaptop,
  IconLayoutGrid,
  IconSettings,
  IconSitemap,
  IconTable,
} from '@tabler/icons-react';

import api from '@/api';
import { useLogomark, useWordmark } from '@/brand';
import { AlertStatusIcon } from '@/components/AlertStatusIcon';
import { InstanceLabel } from '@/components/AppNav/InstanceLabel';
import { useMobileNavOverlay } from '@/components/AppNav/useMobileNavOverlay';
import { useCompactViewport } from '@/components/CompactViewport/useCompactViewport';
import { APP_VERSION, IS_LOCAL_MODE } from '@/config';
import { Dashboard, useDashboards } from '@/dashboard';
import { useFavorites } from '@/favorites';
import { setHdxIdentity } from '@/hdxDebug';
import InstallInstructionModal from '@/InstallInstructionsModal';
import OnboardingChecklist from '@/OnboardingChecklist';
import { useSavedSearches } from '@/savedSearch';
import { getTimeZoneShortName } from '@/timeZone';
import { useDisplayTimeZone } from '@/useDisplayTimeZone';
import { UserPreferencesModal } from '@/UserPreferencesModal';

import {
  AppNavCloudBanner,
  AppNavContext,
  AppNavHelpMenu,
  AppNavLink,
  AppNavUserMenu,
} from './AppNav.components';
import { AppNavFeedback } from './AppNavFeedback';

import styles from './AppNav.module.scss';

// Newest release version in the notes, inlined by next.config.mjs. Separate from
// APP_VERSION on purpose: this one answers "what is the latest release?", which
// is what the Help sparkle is for, while APP_VERSION answers "what build is
// this?" and carries a build id that moves on every deploy.
const WHATS_NEW_VERSION = process.env.NEXT_PUBLIC_WHATS_NEW_VERSION;

// Reo.dev client ID for our usage tracking. USAGE_STATS_ENABLED is the opt-out.
const REO_CLIENT_ID = '38b2e79cdb32fa7';

declare global {
  interface Window {
    Reo?: { init: (options: { clientID: string; source?: string }) => void };
  }
}

// Navigation link configuration
type NavLinkConfig = {
  id: string;
  label: string;
  href: string;
  icon: React.ReactNode;
  isBeta?: boolean;
  cloudOnly?: boolean; // Only show when not in local mode
};

const RAIL_WIDTH = 50;
const FULL_NAV_WIDTH = 250;

const NAV_LINKS: NavLinkConfig[] = [
  {
    id: 'chart',
    label: 'Chart explorer',
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
    label: 'Client sessions',
    href: '/sessions',
    icon: <IconDeviceLaptop size={16} />,
  },
  {
    id: 'service-map',
    label: 'Service map',
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

  const [isPreferCollapsed, setIsPreferCollapsed] = useLocalStorage<boolean>({
    key: 'isNavCollapsed',
    defaultValue: false,
  });

  const isCompact = useCompactViewport();
  const {
    isOpen: isMobileNavOpen,
    toggle: toggleMobileNav,
    close: closeMobileNav,
  } = useMobileNavOverlay(isCompact);
  const collapseButtonRef = useRef<HTMLButtonElement>(null);
  const wasMobileNavOpenRef = useRef(false);
  // Traps Tab inside the open overlay so keys do not reach the page under the scrim.
  const navFocusTrapRef = useFocusTrap(isMobileNavOpen);

  // The toggle stays mounted when the overlay closes, so keyboard focus can
  // return to it after Escape or the scrim removes itself.
  useEffect(() => {
    if (wasMobileNavOpenRef.current && !isMobileNavOpen) {
      collapseButtonRef.current?.focus();
    }
    wasMobileNavOpenRef.current = isMobileNavOpen;
  }, [isMobileNavOpen]);

  // The page layout reserves the rail width even while the overlay is open,
  // so opening the nav does not shift the content.
  const isRail = isCompact || isPreferCollapsed;
  const isCollapsed = isRail && !isMobileNavOpen;
  const navWidth = isCollapsed ? RAIL_WIDTH : FULL_NAV_WIDTH;
  const reservedWidth = isRail ? RAIL_WIDTH : FULL_NAV_WIDTH;
  // The in-flow rail is border-box, so its 1px border is already inside
  // reservedWidth. The fixed nav's ghost keeps the extra pixel it had
  // before. The overlay ghost must not, or the page shifts when it opens.
  const ghostWidth =
    isMobileNavOpen && !fixed ? reservedWidth : reservedWidth + 1;

  useEffect(() => {
    if (meData != null) {
      setUser({ id: meData.id, email: meData.email, name: meData.name });
      // Un-namespaced because the Sessions page reads teamName (sessions.ts)
      setAttributes({ teamName: meData.team.name });
      // Fold user/team ids + per-user toggles into window.hdx for debug reports.
      setHdxIdentity({
        userId: meData.id,
        teamId: meData.team.id,
        features: {
          usageStats: meData.usageStatsEnabled,
          aiAssistant: meData.aiAssistantEnabled,
        },
      });
    }
  }, [meData]);

  const renderSavedSearchLink = useCallback(
    (savedSearch: SavedSearchListApiResponse) => (
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
        <Group gap={2} wrap="nowrap" align="center">
          <div className="text-truncate">{savedSearch.name}</div>
          <Flex flex={0}>
            <AlertStatusIcon alerts={savedSearch.alerts} />
          </Flex>
        </Group>
      </Link>
    ),
    [query.savedSearchId],
  );

  const renderDashboardLink = useCallback(
    (dashboard: Dashboard) => {
      const alerts = dashboard.tiles
        .map(t => t.config.alert)
        .filter(a => a != null);
      return (
        <Link
          href={`/dashboards/${dashboard.id}`}
          key={dashboard.id}
          tabIndex={0}
          className={cx(styles.subMenuItem, {
            [styles.subMenuItemActive]: dashboard.id === query.dashboardId,
          })}
          title={dashboard.name}
        >
          <Group gap={2} wrap="nowrap" align="center">
            <div className="text-truncate">{dashboard.name}</div>
            <Flex flex={0}>
              <AlertStatusIcon alerts={alerts} />
            </Flex>
          </Group>
        </Link>
      );
    },
    [query.dashboardId],
  );

  const [
    UserPreferencesOpen,
    { close: closeUserPreferences, open: openUserPreferences },
  ] = useDisclosure(false);

  const timeZone = useDisplayTimeZone();
  const timeZoneShortName = timeZone && getTimeZoneShortName(timeZone);

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
      pathname === '/kubernetes' ||
      pathname === '/llm';

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
    <AppNavContext value={{ isCollapsed, pathname }}>
      {(fixed || isMobileNavOpen) && (
        <div
          className={styles.navGhost}
          style={{
            width: ghostWidth,
            minWidth: ghostWidth,
          }}
        ></div>
      )}
      {isMobileNavOpen && (
        <button
          type="button"
          className={styles.navScrim}
          aria-label="Close navigation"
          onClick={closeMobileNav}
        />
      )}
      <InstallInstructionModal
        show={showInstallInstructions}
        onHide={closeInstallInstructions}
      />
      <div
        ref={navFocusTrapRef}
        data-testid="app-nav"
        className={cx(styles.nav, {
          [styles.navFixed]: fixed || isMobileNavOpen,
          [styles.navOverlay]: isMobileNavOpen,
          [styles.navCollapsed]: isCollapsed,
          [styles.navCompactRail]: isCompact && !isMobileNavOpen,
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
                <Group
                  gap="xs"
                  align="center"
                  wrap="nowrap"
                  style={{ minWidth: 0 }}
                >
                  {wordmark}
                  {/* Label and UTC badge are mutually exclusive - showing both
                      would be redundant and crowd this already-tight row. */}
                  <InstanceLabel
                    fallback={
                      timeZoneShortName && (
                        <Badge
                          size="sm"
                          text={timeZoneShortName}
                          state="neutral"
                          title={`Showing time in ${timeZoneShortName}`}
                        />
                      )
                    }
                  />
                </Group>
              )}
            </Link>
            {/* click-ui 0.12 has no sidebar-left icon, so the glyph is
                inlined. Chrome matches IconButton type="primary" size="sm". */}
            <button
              ref={collapseButtonRef}
              type="button"
              className={cx(styles.collapseButton, {
                [styles.collapseButtonCollapsed]: isCollapsed,
              })}
              title="Collapse/expand navigation"
              aria-label="Collapse/expand navigation"
              aria-expanded={!isCollapsed}
              data-autofocus={isMobileNavOpen ? true : undefined}
              onClick={() =>
                isCompact
                  ? toggleMobileNav()
                  : setIsPreferCollapsed((v: boolean) => !v)
              }
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <path
                  fill="currentColor"
                  d="M20.25 5C20.25 4.30921 19.6908 3.75 19 3.75H10.752H9.25195H5C4.30921 3.75 3.75 4.30921 3.75 5V19C3.75 19.6908 4.30921 20.25 5 20.25H9.25195H10.752H19C19.6908 20.25 20.25 19.6908 20.25 19V5ZM21.75 19C21.75 20.5192 20.5192 21.75 19 21.75H5C3.48079 21.75 2.25 20.5192 2.25 19V5C2.25 3.48079 3.48079 2.25 5 2.25H19C20.5192 2.25 21.75 3.48079 21.75 5V19Z"
                />
                <path
                  fill="currentColor"
                  d="M9.25195 3.75V20.25H10.752V3.75H9.25195Z"
                />
              </svg>
            </button>
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
              label="Saved searches"
              href="/search/list"
              icon={<IconDeviceFloppy size={16} />}
              isActive={isSavedSearchActive}
              isExpanded={isSavedSearchExpanded}
              onToggle={() => setIsSavedSearchExpanded(!isSavedSearchExpanded)}
            />

            {!isCollapsed && (
              <Collapse expanded={isSavedSearchExpanded}>
                <div className={styles.subMenu}>
                  {favoritedSavedSearches.length > 0 ? (
                    favoritedSavedSearches.map(renderSavedSearchLink)
                  ) : favorites != null && savedSearches != null ? (
                    <Text size="xs" c="dimmed" pl="lg" pr="xs" py={4} lh={1.4}>
                      No favorites. Star on{' '}
                      <Anchor component={Link} href="/search/list" size="xs">
                        Saved searches
                      </Anchor>
                      .
                    </Text>
                  ) : null}
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

            {!isCollapsed && (
              <Collapse expanded={isDashboardsExpanded}>
                <div className={styles.subMenu}>
                  {favoritedDashboards.length > 0 ? (
                    favoritedDashboards.map(renderDashboardLink)
                  ) : favorites != null && dashboards != null ? (
                    <Text size="xs" c="dimmed" pl="lg" pr="xs" py={4} lh={1.4}>
                      No favorites. Star on{' '}
                      <Anchor
                        component={Link}
                        href="/dashboards/list"
                        size="xs"
                      >
                        Dashboards
                      </Anchor>
                      .
                    </Text>
                  ) : null}
                </div>
              </Collapse>
            )}

            {/* Help */}
            <AppNavHelpMenu
              version={APP_VERSION}
              whatsNewVersion={WHATS_NEW_VERSION}
            />

            {/* Feedback */}
            <AppNavFeedback />

            {/* Team Settings (Cloud only) */}
            {!IS_LOCAL_MODE && (
              <AppNavLink
                label="Team settings"
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
          {meData?.usageStatsEnabled && (
            <Script
              id="reo-beacon"
              strategy="afterInteractive"
              src={`https://static.reo.dev/${REO_CLIENT_ID}/reo.js`}
              onLoad={() => {
                window.Reo?.init({
                  clientID: REO_CLIENT_ID,
                  source: 'internal',
                });
              }}
            />
          )}
        </div>
      </div>
      <UserPreferencesModal
        opened={UserPreferencesOpen}
        onClose={closeUserPreferences}
      />
    </AppNavContext>
  );
}
