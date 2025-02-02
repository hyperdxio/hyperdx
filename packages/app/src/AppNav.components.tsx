import React from 'react';
import Link from 'next/link';
import cx from 'classnames';
import {
  ActionIcon,
  Avatar,
  Button,
  Group,
  Menu,
  Paper,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { Icon } from '@/components/Icon';
import InstallInstructionModal from '@/InstallInstructionsModal';
import { useSources } from '@/source';

import { IS_LOCAL_MODE } from './config';

import styles from '../styles/AppNav.module.scss';

export const AppNavContext = React.createContext<{
  isCollapsed: boolean;
  pathname: string;
}>({
  isCollapsed: false,
  pathname: '/',
});

export const AppNavCloudBanner = () => {
  return (
    <div className="my-3 bg-hdx-dark rounded p-2 text-center">
      <span className="text-slate-300 fs-8">Ready to use HyperDX Cloud?</span>
      <div className="mt-2 mb-2">
        <Link href="https://www.hyperdx.io/register" passHref legacyBehavior>
          <Button
            variant="light"
            size="xs"
            component="a"
            className="hover-color-white"
          >
            Get Started for Free
          </Button>
        </Link>
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

  return (
    <Menu position="top-start" transitionProps={{ transition: 'fade-up' }}>
      <Menu.Target>
        <Paper
          m="sm"
          mt={8}
          px={8}
          py={4}
          radius="md"
          {...(isCollapsed && {
            p: 2,
            bg: 'transparent',
          })}
          className={styles.appNavMenu}
        >
          <Group gap="xs" wrap="nowrap" miw={0}>
            <Avatar size="sm" radius="xl" color="green">
              {initials}
            </Avatar>
            {!isCollapsed && (
              <>
                <div style={{ flex: 1 }}>
                  <Text size="xs" fw="bold" lh={1.1} c="gray.3">
                    {IS_LOCAL_MODE ? 'Local mode' : userName}
                  </Text>
                  <Text
                    size="xs"
                    c="dimmed"
                    style={{
                      fontSize: 11,
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxHeight: 16,
                    }}
                  >
                    {teamName}
                  </Text>
                </div>
                <Icon name="chevron-right" className="fs-8 text-slate-400" />
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
            href="/team"
            component={Link}
            leftSection={<Icon name="gear" />}
          >
            Team Settings
          </Menu.Item>
        )}
        <Menu.Item
          leftSection={<Icon name="person-gear" />}
          onClick={onClickUserPreferences}
        >
          User Preferences
        </Menu.Item>
        {logoutUrl && (
          <>
            <Menu.Divider />
            <Menu.Item
              color="red"
              leftSection={<Icon name="box-arrow-left" />}
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

const useIsTeamHasNoData = () => {
  const now = React.useMemo(() => new Date(), []);
  const ago14d = React.useMemo(
    () => new Date(Date.now() - 1000 * 60 * 60 * 24 * 14),
    [],
  );

  const { data: sources } = useSources();

  return Array.isArray(sources) && sources?.length > 0 ? false : true;
};

export const AppNavHelpMenu = ({ version }: { version?: string }) => {
  const { isCollapsed } = React.useContext(AppNavContext);

  const [
    installModalOpen,
    { close: closeInstallModal, open: openInstallModal },
  ] = useDisclosure(false);

  // const isTeamHasNoData = useIsTeamHasNoData();
  const size = 28;

  return (
    <>
      <Paper
        mb={8}
        ml="sm"
        withBorder
        w={size}
        h={size}
        radius="xl"
        {...(isCollapsed && {
          ml: 'sm',
        })}
        className={styles.appNavMenu}
      >
        <Menu
          withArrow
          position="top-start"
          transitionProps={{ transition: 'fade-up' }}
          defaultOpened={false}
        >
          <Menu.Target>
            <UnstyledButton w="100%">
              <Group
                align="center"
                justify="center"
                h={size}
                className="text-slate-200 "
              >
                <Icon name="question-lg" />
              </Group>
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>
              Help{' '}
              {version && (
                <Text size="xs" c="gray.7" component="span">
                  v{version}
                </Text>
              )}
            </Menu.Label>

            <Menu.Item
              href="https://hyperdx.io/docs/v2"
              component="a"
              leftSection={<Icon name="book" />}
            >
              Documentation
            </Menu.Item>
            <Menu.Item
              leftSection={<Icon name="discord" />}
              component="a"
              href="https://hyperdx.io/discord"
              target="_blank"
            >
              Discord Community
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
  iconName,
  href,
  isExpanded,
  onToggle,
}: {
  className?: string;
  label: React.ReactNode;
  iconName: string;
  href: string;
  isExpanded?: boolean;
  onToggle?: () => void;
}) => {
  const { pathname, isCollapsed } = React.useContext(AppNavContext);

  return (
    <Group justify="space-between" px="md" py="xs">
      <Link
        href={href}
        className={cx(
          className,
          'text-decoration-none d-flex justify-content-between align-items-center fs-7 text-muted-hover',
          { 'fw-bold text-success': pathname?.includes(href) },
        )}
      >
        <span>
          <i className={`bi ${iconName} pe-1 text-slate-300`} />{' '}
          {!isCollapsed && <span>{label}</span>}
        </span>
      </Link>
      {!isCollapsed && onToggle && (
        <ActionIcon
          variant="subtle"
          color="dark.2"
          size="sm"
          onClick={onToggle}
        >
          <i
            className={`fs-8 bi bi-chevron-${
              isExpanded ? 'up' : 'down'
            } text-muted-hover`}
          />
        </ActionIcon>
      )}
    </Group>
  );
};
