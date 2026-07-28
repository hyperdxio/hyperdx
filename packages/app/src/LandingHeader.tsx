import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Anchor, Burger, Button, Container, Group } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { useBrandDisplayName, useWordmark } from './theme/ThemeProvider';
import api from './api';

export default function LandingHeader({
  activeKey,
  fixed,
}: {
  activeKey: string;
  fixed?: boolean;
}) {
  const { t } = useTranslation('auth');
  const brandName = useBrandDisplayName();
  const wordmark = useWordmark();
  const { data: me } = api.useMe();
  const isLoggedIn = Boolean(me);

  const { data: installation } = api.useInstallation();
  const [opened, { toggle }] = useDisclosure(false);

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          background: 'var(--color-bg-body)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--color-border)',
          zIndex: 100,
        }}
      >
        <Container fluid px="xl" py="md">
          <Group justify="space-between" align="center">
            <Link href="/" style={{ textDecoration: 'none' }}>
              {wordmark}
            </Link>

            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="lg"
              color="white"
            />

            <Group gap="lg" visibleFrom="lg">
              <Anchor
                href="https://hyperdx.io"
                c={activeKey === 'cloud' ? 'var(--color-text-primary)' : 'gray'}
                underline="never"
                style={{ fontWeight: activeKey === 'cloud' ? 600 : 400 }}
                size="sm"
              >
                {t('header.cloud', { brandName })}
              </Anchor>
              <Anchor
                href="https://clickhouse.com/docs/use-cases/observability/clickstack"
                c={activeKey === 'docs' ? 'var(--color-text-primary)' : 'gray'}
                underline="never"
                style={{ fontWeight: activeKey === 'docs' ? 600 : 400 }}
                size="sm"
              >
                {t('header.docs')}
              </Anchor>
              {!isLoggedIn && installation?.isTeamExisting === true && (
                <Anchor
                  href="/login"
                  c={
                    activeKey === '/login'
                      ? 'var(--color-text-primary)'
                      : 'gray'
                  }
                  underline="never"
                  style={{ fontWeight: activeKey === '/login' ? 600 : 400 }}
                  size="sm"
                >
                  {t('header.login')}
                </Anchor>
              )}
              {!isLoggedIn &&
                activeKey !== '/register' &&
                installation?.isTeamExisting === false && (
                  <Link href="/register">
                    <Button variant="primary" size="sm">
                      {t('header.setupAccount')}
                    </Button>
                  </Link>
                )}
              {isLoggedIn && (
                <Link href="/search">
                  <Button variant="primary" size="sm">
                    {t('header.goToSearch')}
                  </Button>
                </Link>
              )}
            </Group>
          </Group>

          {/* Mobile menu */}
          {opened && (
            <Group gap="sm" mt="md" hiddenFrom="lg" style={{ fontSize: 14 }}>
              <Anchor
                href="https://hyperdx.io"
                underline="never"
                style={{ fontWeight: activeKey === 'cloud' ? 600 : 400 }}
              >
                {t('header.cloud', { brandName })}
              </Anchor>
              <Anchor
                href="https://clickhouse.com/docs/use-cases/observability/clickstack"
                underline="never"
                style={{ fontWeight: activeKey === 'docs' ? 600 : 400 }}
              >
                {t('header.docs')}
              </Anchor>
              {!isLoggedIn && installation?.isTeamExisting === true && (
                <Anchor
                  href="/login"
                  underline="never"
                  style={{ fontWeight: activeKey === '/login' ? 600 : 400 }}
                >
                  {t('header.login')}
                </Anchor>
              )}
              {!isLoggedIn &&
                activeKey !== '/register' &&
                installation?.isTeamExisting === false && (
                  <Link href="/register">
                    <Button variant="primary" size="sm" fullWidth>
                      {t('header.setupAccount')}
                    </Button>
                  </Link>
                )}
              {isLoggedIn && (
                <Link href="/search">
                  <Button variant="primary" size="sm" fullWidth>
                    {t('header.goToSearch')}
                  </Button>
                </Link>
              )}
            </Group>
          )}
        </Container>
      </div>
      {!fixed && <div style={{ height: 70 }} />}
    </>
  );
}
