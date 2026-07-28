import React from 'react';
import Link from 'next/link';
import cx from 'classnames';
import { useTranslation } from 'react-i18next';
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
  IconKeyboard,
  IconLogout,
  IconSettings,
  IconSparkles,
  IconUserCog,
} from '@tabler/icons-react';

import { IS_LOCAL_MODE } from '@/config';

import { ChangelogModal } from './ChangelogModal';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';

import styles from './AppNav.module.scss';

export const AppNavContext = React.createContext<{
  isCollapsed: boolean;
  pathname: string;
}>({
  isCollapsed: false,
  pathname: '/',
});

export const AppNavCloudBanner = () => {
  const { t } = useTranslation('navigation');

  return (
    <div className="my-3 bg-muted rounded p-2 text-center">
      <span className="fs-8">{t('cloudBanner.prompt')}</span>
      <div className="mt-2 mb-2">
        <Button
          variant="primary"
          size="xs"
          component="a"
          href="https://clickhouse.com/docs/use-cases/observability/clickstack/getting-started#deploy-with-clickhouse-cloud"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('cloudBanner.action')}
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

const getUserInitials = (userName: string) => {
  const nameParts = userName.trim().split(/\s+/).filter(Boolean);

  if (nameParts.length === 0) {
    return 'U';
  }

  return nameParts.map(name => name.charAt(0).toUpperCase()).join('');
};

export const AppNavUserMenu = ({
  userName,
  teamName,
  logoutUrl,
  onClickUserPreferences,
}: AppNavUserMenuProps) => {
  const { t } = useTranslation('navigation');
  const { isCollapsed } = React.useContext(AppNavContext);
  const resolvedUserName = userName?.trim() || t('userMenu.defaultUser');

  const initials = getUserInitials(resolvedUserName);

  const displayName = IS_LOCAL_MODE
    ? t('userMenu.localMode')
    : resolvedUserName;

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
          <Menu.Label fz="xs">{t('userMenu.localMode')}</Menu.Label>
        ) : (
          <Menu.Item
            data-testid="team-settings-menu-item"
            href="/team"
            component={Link}
            leftSection={<IconSettings size={16} />}
          >
            {t('links.teamSettings')}
          </Menu.Item>
        )}
        <Menu.Item
          data-testid="user-preferences-menu-item"
          leftSection={<IconUserCog size={16} />}
          onClick={onClickUserPreferences}
        >
          {t('userMenu.preferences')}
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
              {t('userMenu.logout')}
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
};

export const AppNavHelpMenu = ({ version }: { version?: string }) => {
  const { t } = useTranslation('navigation');
  const { isCollapsed } = React.useContext(AppNavContext);
  const [
    shortcutsOpened,
    { open: openShortcutsModal, close: closeShortcutsModal },
  ] = useDisclosure(false);
  const [
    changelogOpened,
    { open: openChangelogModal, close: closeChangelogModal },
  ] = useDisclosure(false);

  return (
    <>
      <Menu
        position="right-start"
        transitionProps={{ transition: 'fade-right' }}
      >
        <Menu.Target>
          <UnstyledButton
            data-testid="help-menu-trigger"
            className={styles.navItem}
          >
            <span className={styles.navItemContent}>
              <span className={styles.navItemIcon}>
                <IconHelp size={16} />
              </span>
              {!isCollapsed && <span>{t('help.label')}</span>}
            </span>
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>
            {t('help.label')}{' '}
            {version && (
              <Text size="xs" component="span">
                {t('help.version', { version })}
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
            {t('links.documentation')}
          </Menu.Item>
          <Menu.Item
            data-testid="setup-instructions-menu-item"
            leftSection={<IconBulb size={16} />}
            href="https://clickhouse.com/docs/use-cases/observability/clickstack/getting-started"
            component="a"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('help.setupInstructions')}
          </Menu.Item>
          <Menu.Item
            data-testid="changelog-menu-item"
            leftSection={<IconSparkles size={16} />}
            onClick={openChangelogModal}
          >
            {t('changelog.whatsNew')}
          </Menu.Item>
          <Menu.Item
            data-testid="keyboard-shortcuts-menu-item"
            leftSection={<IconKeyboard size={16} />}
            onClick={openShortcutsModal}
          >
            {t('help.keyboardShortcuts')}
          </Menu.Item>
          <Menu.Item
            data-testid="discord-menu-item"
            leftSection={<IconBrandDiscord size={16} />}
            component="a"
            href="https://hyperdx.io/discord"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('help.discord')}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <KeyboardShortcutsModal
        opened={shortcutsOpened}
        onClose={closeShortcutsModal}
      />
      <ChangelogModal opened={changelogOpened} onClose={closeChangelogModal} />
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
  isActive,
}: {
  className?: string;
  label: React.ReactNode;
  icon: React.ReactNode;
  href: string;
  isExpanded?: boolean;
  onToggle?: () => void;
  isBeta?: boolean;
  isActive?: boolean;
}) => {
  const { t } = useTranslation('navigation');
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
  const defaultIsActive = pathname === href || pathname?.startsWith(href + '/');
  const isActiveResolved = isActive ?? defaultIsActive;

  return (
    <Link
      data-testid={testId}
      href={href}
      className={cx(
        styles.navItem,
        { [styles.navItemActive]: isActiveResolved },
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
          {t('badges.beta')}
        </Badge>
      )}
      {!isCollapsed && onToggle && (
        <Tooltip
          label={isExpanded ? t('favorites.hide') : t('favorites.show')}
          position="right"
        >
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
        </Tooltip>
      )}
    </Link>
  );
};
