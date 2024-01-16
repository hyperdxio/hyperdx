import React from 'react';

import AppNav from './AppNav';

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
    <div className="d-flex">
      <AppNav fixed />
      <div className="w-100">{page}</div>
    </div>
  );
};
