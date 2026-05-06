import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import type { ComponentType } from 'react';

import type { CatalogTreeSelection } from '@/components/Catalog/CatalogTree';
import { withAppNav } from '@/layout';

const CatalogPage = dynamic(() => import('@/components/Catalog/CatalogPage'), {
  ssr: false,
}) as ComponentType<{ initial?: CatalogTreeSelection }>;

/**
 * Deep-link route. Reuses `CatalogPage` with the URL-derived selection so
 * the right pane renders directly without forcing the user to click
 * through the tree.
 */
function CatalogDeepLinkPage() {
  const router = useRouter();
  const { catalogId, database, table } = router.query;

  if (
    typeof catalogId !== 'string' ||
    typeof database !== 'string' ||
    typeof table !== 'string'
  ) {
    return null;
  }

  return <CatalogPage initial={{ catalogId, database, table }} />;
}

// @ts-ignore - getLayout pattern from /layout.tsx
CatalogDeepLinkPage.getLayout = withAppNav;

export default CatalogDeepLinkPage;
