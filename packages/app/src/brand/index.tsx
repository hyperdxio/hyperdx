import { useMemo } from 'react';

import { INSTANCE_TITLE_SUFFIX } from '@/config';

import Logomark from './Logomark';
import Wordmark from './Wordmark';

export const BRAND_DISPLAY_NAME = 'ClickStack';

// Named as a hook so a downstream build can read state here without
// renaming every call site. This build returns a constant.
// eslint-disable-next-line @eslint-react/no-unnecessary-use-prefix
export function useBrandDisplayName(): string {
  return BRAND_DISPLAY_NAME;
}

/**
 * Page title: brand name plus the configured instance label, with an
 * optional page name prepended.
 * e.g. usePageTitle('Search') => "Search - ClickStack"
 */
// eslint-disable-next-line @eslint-react/no-unnecessary-use-prefix -- see useBrandDisplayName
export function usePageTitle(page?: string): string {
  const brandTitle = `${BRAND_DISPLAY_NAME}${INSTANCE_TITLE_SUFFIX}`;
  return page ? `${page} - ${brandTitle}` : brandTitle;
}

// The hooks return elements so callers do not render a component created
// during render. A downstream build replaces this module to change the
// name and the marks without editing each call site.
export function useWordmark() {
  return useMemo(() => <Wordmark name={BRAND_DISPLAY_NAME} />, []);
}

export function useLogomark(props?: { size?: number }) {
  const size = props?.size;
  return useMemo(() => <Logomark size={size} />, [size]);
}
