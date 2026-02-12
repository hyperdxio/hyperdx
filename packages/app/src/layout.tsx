import React from 'react';
import Link from 'next/link';
import { Box, Center, Text } from '@mantine/core';

import AppNav from '@/components/AppNav';
import { IS_CLICKHOUSE_BUILD } from '@/config';

import { HDXSpotlightProvider } from './Spotlights';

/**
 * Next.js layout for pages that use the AppNav component. Using the same layout
 * for all pages that use the AppNav component ensures that the AppNav state, such as
 * scroll position, input values, etc. is preserved when navigating between pages.
 *
 * https://nextjs.org/docs/pages/building-your-application/routing/pages-and-layouts
 *
 * @example SearchPage.getLayout = withAppNav;
 */
export const withAppNav = (page: React.ReactNode) => {
  return (
    <HDXSpotlightProvider>
      <div
        className={
          IS_CLICKHOUSE_BUILD ? 'app-layout-with-banner' : 'app-layout'
        }
      >
        {IS_CLICKHOUSE_BUILD && (
          <Box bg="var(--color-text-primary)">
            <Center>
              <Text py="xs" size="sm" c="var(--color-text-inverted)">
                This is not recommended for production use and is lacking core
                ClickStack features such as alerts and saved searches. For a
                proper experience, visit the{' '}
                <strong>
                  <Link
                    href="https://clickhouse.com/docs/use-cases/observability/clickstack/getting-started"
                    target="_blank"
                    rel="noopener norefeer"
                  >
                    ClickStack Docs
                  </Link>
                </strong>
              </Text>
            </Center>
          </Box>
        )}
        <div className="d-flex" style={{ height: '100%', overflow: 'hidden' }}>
          <AppNav />
          <div
            className="w-100 min-w-0"
            style={{ minWidth: 0, overflow: 'auto' }}
          >
            {page}
          </div>
        </div>
      </div>
    </HDXSpotlightProvider>
  );
};
