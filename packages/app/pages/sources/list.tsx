import dynamic from 'next/dynamic';

import { withAppNav } from '@/layout';

const SourcesListPage = dynamic(
  () => import('@/components/Sources/SourcesList'),
  { ssr: false },
);

// @ts-ignore - getLayout pattern from /layout.tsx
SourcesListPage.getLayout = withAppNav;

export default SourcesListPage;
