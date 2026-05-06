import dynamic from 'next/dynamic';

import { withAppNav } from '@/layout';

const CatalogPage = dynamic(() => import('@/components/Catalog/CatalogPage'), {
  ssr: false,
});

// @ts-ignore - getLayout pattern from /layout.tsx
CatalogPage.getLayout = withAppNav;

export default CatalogPage;
