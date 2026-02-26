import React from 'react';
import Link from 'next/link';
import { Button, Center, Group, Text } from '@mantine/core';
import { IconX } from '@tabler/icons-react';

import AppNav from '@/components/AppNav';
import { IS_CLICKHOUSE_BUILD } from '@/config';

import { HDXSpotlightProvider } from './Spotlights';
import { useLocalStorage } from './utils';

/**
 * Next.js layout for pages that use the AppNav component. Using the same layout
 * for all pages that use the AppNav component ensures that the AppNav state, such as
 * scroll position, input values, etc. is preserved when navigating between pages.
 *
 * https://nextjs.org/docs/pages/building-your-application/routing/pages-and-layouts
 *
 * @example SearchPage.getLayout = withAppNav;
 */
function PageWrapper({ children }: { children: React.ReactNode }) {
  const [bannerState, setBannerState] = useLocalStorage(
    'clickstack-banner-state',
    'opened',
  );
  const [hasMounted, setHasMounted] = React.useState(false); // prevents banner flash
  React.useEffect(() => setHasMounted(true), []);
  const bannerIsActive =
    hasMounted && IS_CLICKHOUSE_BUILD && bannerState === 'opened';

  return (
    <div className={bannerIsActive ? 'app-layout-with-banner' : 'app-layout'}>
      {bannerIsActive && (
        <Group bg="var(--color-text-primary)">
          <Center style={{ flexGrow: 1 }}>
            <Text py="xs" size="sm" c="var(--color-text-inverted)">
              This is not recommended for production use and is lacking core
              ClickStack features such as alerts and saved searches. For a
              proper experience, visit the{' '}
              <strong>
                <Link
                  href="https://clickhouse.com/docs/use-cases/observability/clickstack/getting-started"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ClickStack Docs
                </Link>
              </strong>
            </Text>
          </Center>
          <Button
            onClick={() => setBannerState('closed')}
            variant="transparent"
            color="var(--color-text-inverted)"
          >
            <IconX />{' '}
          </Button>
        </Group>
      )}
      <div className="d-flex" style={{ height: '100%', overflow: 'hidden' }}>
        <AppNav />
        <div
          className="w-100 min-w-0"
          style={{ minWidth: 0, overflow: 'auto' }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export const withAppNav = (page: React.ReactNode): React.ReactNode => {
  return (
    <HDXSpotlightProvider>
      <PageWrapper>{page}</PageWrapper>
    </HDXSpotlightProvider>
  );
};
