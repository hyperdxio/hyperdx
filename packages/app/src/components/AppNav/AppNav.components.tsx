import React from 'react';
import Link from 'next/link';
import cx from 'classnames';
import {
  Avatar,
  Badge,
  Button,
  Group,
  Menu,
  Paper,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconBook,
  IconBrandDiscord,
  IconBulb,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconHelp,
  IconLogout,
  IconSettings,
  IconUserCog,
} from '@tabler/icons-react';

import { IS_LOCAL_MODE } from '@/config';
import InstallInstructionModal from '@/InstallInstructionsModal';

import styles from './AppNav.module.scss';

export const AppNavContext = React.createContext<{
  isCollapsed: boolean;
  pathname: string;
}>({
  isCollapsed: false,
  pathname: '/',
});

export const AppNavCloudBanner = () => {
  return (
    <div className="my-3 bg-muted rounded p-2 text-center">
      <span className="fs-8">Ready to deploy on ClickHouse Cloud?</span>
      <div className="mt-2 mb-2">
        <Button
          variant="primary"
          size="xs"
          component="a"
          href="https://clickhouse.com/docs/use-cases/observability/clickstack/getting-started#deploy-with-clickhouse-cloud"
          target="_blank"
          rel="noopener noreferrer"
        >
          Get Started for Free
        </Button>
      </div>
    </div>
  );
};

type AppNavUserMenuProps = {
  userName?: string;
  teamName?: string;
  logoutUrl?: string | null;
  onClickUserPreferences?: () => void;
};

export const AppNavUserMenu = ({
  userName = 'User',
  teamName,
  logoutUrl,
  onClickUserPreferences,
}: AppNavUserMenuProps) => {
  const { isCollapsed } = React.useContext(AppNavContext);

  const initials = userName
    .split(' ')
    .map(name => name[0].toUpperCase())
    .join('');

  const displayName = IS_LOCAL_MODE ? 'Local mode' : userName;

  return (
    <Menu position="top-start" transitionProps={{ transition: 'fade-up' }}>
      <Menu.Target>
        <Paper
          data-testid="user-menu-trigger"
          className={cx(styles.userMenu, {
            [styles.userMenuCollapsed]: isCollapsed,
          })}
        >
          <Group gap="xs" wrap="nowrap" miw={0}>
            <Avatar size="sm" radius="xl" color="gray">
              {initials}
            </Avatar>
            {!isCollapsed && (
              <>
                <Tooltip
                  fz="xs"
                  color="gray"
                  ta="center"
                  label={
                    <>
                      <strong>{displayName}</strong>
                      <br />
                      {teamName}
                    </>
                  }
                  openDelay={250}
                >
                  <div className={styles.userMenuInfo}>
                    <Text
                      size="xs"
                      fw="bold"
                      lh={1.1}
                      className={styles.userMenuName}
                    >
                      {displayName}
                    </Text>
                    <Text size="xs" className={styles.userMenuTeam}>
                      {teamName}
                    </Text>
                  </div>
                </Tooltip>
                <IconChevronRight size={14} />
              </>
            )}
          </Group>
        </Paper>
      </Menu.Target>
      <Menu.Dropdown>
        {IS_LOCAL_MODE ? (
          <Menu.Label fz="xs">Local mode</Menu.Label>
        ) : (
          <Menu.Item
            data-testid="team-settings-menu-item"
            href="/team"
            component={Link}
            leftSection={<IconSettings size={16} />}
          >
            Team Settings
          </Menu.Item>
        )}
        <Menu.Item
          data-testid="user-preferences-menu-item"
          leftSection={<IconUserCog size={16} />}
          onClick={onClickUserPreferences}
        >
          User Preferences
        </Menu.Item>
        {logoutUrl && (
          <>
            <Menu.Divider />
            <Menu.Item
              data-testid="logout-menu-item"
              color="red"
              leftSection={<IconLogout size={16} />}
              component={Link}
              href={logoutUrl}
            >
              Logout
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
};

export const AppNavHelpMenu = ({
  version,
  onAddDataClick,
}: {
  version?: string;
  onAddDataClick?: () => void;
}) => {
  const { isCollapsed } = React.useContext(AppNavContext);

  const [
    installModalOpen,
    { close: closeInstallModal, open: _openInstallModal },
  ] = useDisclosure(false);

  return (
    <>
      <Paper
        className={cx(styles.helpButton, {
          [styles.helpButtonCollapsed]: isCollapsed,
        })}
      >
        <Menu
          withArrow
          position="top-start"
          transitionProps={{ transition: 'fade-up' }}
          defaultOpened={false}
        >
          <Menu.Target>
            <UnstyledButton data-testid="help-menu-trigger" w="100%">
              <Group align="center" justify="center" h={28}>
                <IconHelp size={16} />
              </Group>
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>
              Help{' '}
              {version && (
                <Text size="xs" component="span">
                  v{version}
                </Text>
              )}
            </Menu.Label>

            <Menu.Item
              data-testid="documentation-menu-item"
              href="https://clickhouse.com/docs/use-cases/observability/clickstack"
              component="a"
              target="_blank"
              rel="noopener noreferrer"
              leftSection={<IconBook size={16} />}
            >
              Documentation
            </Menu.Item>
            <Menu.Item
              data-testid="discord-menu-item"
              leftSection={<IconBrandDiscord size={16} />}
              component="a"
              href="https://hyperdx.io/discord"
              target="_blank"
              rel="noopener noreferrer"
            >
              Discord Community
            </Menu.Item>
            <Menu.Item
              data-testid="setup-instructions-menu-item"
              leftSection={<IconBulb size={16} />}
              onClick={onAddDataClick}
            >
              Setup Instructions
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Paper>
      <InstallInstructionModal
        show={installModalOpen}
        onHide={closeInstallModal}
      />
    </>
  );
};

export const AppNavLink = ({
  className,
  label,
  icon,
  href,
  isExpanded,
  onToggle,
  isBeta,
}: {
  className?: string;
  label: React.ReactNode;
  icon: React.ReactNode;
  href: string;
  isExpanded?: boolean;
  onToggle?: () => void;
  isBeta?: boolean;
}) => {
  const { pathname, isCollapsed } = React.useContext(AppNavContext);

  const testId = `nav-link-${href.replace(/^\//, '').replace(/\//g, '-') || 'home'}`;

  const handleToggleClick = (e: React.MouseEvent) => {
    // Clicking chevron only toggles submenu, doesn't navigate
    // This separates navigation (clicking link) from expand/collapse (clicking chevron)
    e.preventDefault();
    e.stopPropagation();
    onToggle?.();
  };

  // Check if current path matches this nav item
  // Use exact match or startsWith to avoid partial matches (e.g., /search matching /search-settings)
  const isActive = pathname === href || pathname?.startsWith(href + '/');

  return (
    <Link
      data-testid={testId}
      href={href}
      className={cx(
        styles.navItem,
        { [styles.navItemActive]: isActive },
        className,
      )}
    >
      <span className={styles.navItemContent}>
        <span className={styles.navItemIcon}>{icon}</span>
        {!isCollapsed && <span>{label}</span>}
      </span>
      {!isCollapsed && isBeta && (
        <Badge
          size="xs"
          color="blue"
          variant="light"
          className={styles.navItemBadge}
        >
          Beta
        </Badge>
      )}
      {!isCollapsed && onToggle && (
        <button
          type="button"
          data-testid={`${testId}-toggle`}
          className={styles.navItemToggle}
          onClick={handleToggleClick}
        >
          {isExpanded ? (
            <IconChevronUp size={14} className="text-muted-hover" />
          ) : (
            <IconChevronDown size={14} className="text-muted-hover" />
          )}
        </button>
      )}
    </Link>
  );
};
