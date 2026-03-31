import { useEffect } from 'react';
import Link from 'next/link';
import Router, { useRouter } from 'next/router';
import cx from 'classnames';
import HyperDX from '@hyperdx/browser';
import {
  ActionIcon,
  Anchor,
  Badge,
  Group,
  ScrollArea,
  Text,
} from '@mantine/core';
import { useDisclosure, useLocalStorage } from '@mantine/hooks';
import {
  IconArrowBarToLeft,
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
import { IS_LOCAL_MODE } from '@/config';
import InstallInstructionModal from '@/InstallInstructionsModal';
import OnboardingChecklist from '@/OnboardingChecklist';
import { useLogomark, useWordmark } from '@/theme/ThemeProvider';
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
              isActive={pathname?.startsWith('/search/')}
            />
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
            />
            {!isCollapsed && (
              <Text size="xs" px="lg" py="xs" fw="lighter" fs="italic">
                Saved searches and dashboards have moved! Try the{' '}
                <Anchor component={Link} href="/search/list">
                  Saved Searches
                </Anchor>{' '}
                or{' '}
                <Anchor component={Link} href="/dashboards/list">
                  Dashboards
                </Anchor>{' '}
                page.
              </Text>
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
