// @ts-nocheck TODO: remove this line

import Link from 'next/link';
import { Anchor, Burger, Button, Container, Group } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import api from './api';
import Logo from './Logo';

export default function LandingHeader({
  activeKey,
  fixed,
}: {
  activeKey: string;
  fixed?: boolean;
}) {
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
          background: '#0f1216b3',
          backdropFilter: 'blur(12px)',
          zIndex: 100,
        }}
      >
        <Container fluid px="xl" py="md">
          <Group justify="space-between" align="center">
            <Link href="/" style={{ textDecoration: 'none' }}>
              <Logo />
            </Link>

            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="lg"
              color="white"
            />

            <Group gap="md" visibleFrom="lg" style={{ fontSize: 14 }}>
              <Anchor
                href="https://hyperdx.io"
                underline="never"
                style={{ fontWeight: activeKey === 'cloud' ? 600 : 400 }}
              >
                HyperDX Cloud
              </Anchor>
              <Anchor
                href="https://clickhouse.com/docs/use-cases/observability/clickstack"
                underline="never"
                style={{ fontWeight: activeKey === 'docs' ? 600 : 400 }}
              >
                Docs
              </Anchor>
              {!isLoggedIn && installation?.isTeamExisting === true && (
                <Anchor
                  href="/login"
                  underline="never"
                  style={{ fontWeight: activeKey === '/login' ? 600 : 400 }}
                >
                  Login
                </Anchor>
              )}
              {!isLoggedIn &&
                activeKey !== '/register' &&
                installation?.isTeamExisting === false && (
                  <Link href="/register" passHref legacyBehavior>
                    <Button
                      component="a"
                      variant="outline"
                      color="green"
                      size="sm"
                    >
                      Setup Account
                    </Button>
                  </Link>
                )}
              {isLoggedIn && (
                <Link href="/search" passHref legacyBehavior>
                  <Button
                    component="a"
                    variant="outline"
                    color="green"
                    size="sm"
                  >
                    Go to Search
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
                HyperDX Cloud
              </Anchor>
              <Anchor
                href="https://clickhouse.com/docs/use-cases/observability/clickstack"
                underline="never"
                style={{ fontWeight: activeKey === 'docs' ? 600 : 400 }}
              >
                Docs
              </Anchor>
              {!isLoggedIn && installation?.isTeamExisting === true && (
                <Anchor
                  href="/login"
                  underline="never"
                  style={{ fontWeight: activeKey === '/login' ? 600 : 400 }}
                >
                  Login
                </Anchor>
              )}
              {!isLoggedIn &&
                activeKey !== '/register' &&
                installation?.isTeamExisting === false && (
                  <Link href="/register" passHref legacyBehavior>
                    <Button
                      component="a"
                      variant="outline"
                      color="green"
                      size="sm"
                      fullWidth
                    >
                      Setup Account
                    </Button>
                  </Link>
                )}
              {isLoggedIn && (
                <Link href="/search" passHref legacyBehavior>
                  <Button
                    component="a"
                    variant="outline"
                    color="green"
                    size="sm"
                    fullWidth
                  >
                    Go to Search
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
