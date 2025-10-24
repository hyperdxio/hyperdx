import React, { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  NumberParam,
  StringParam,
  useQueryParam,
  useQueryParams,
  withDefault,
} from 'use-query-params';

/**
 * ContextAwareLink - A Link component that preserves search context
 *
 * Automatically carries over time range and search parameters when navigating
 * between /search and /chart pages, making context flow seamless.
 *
 * Usage: Drop-in replacement for Next.js Link
 * <ContextAwareLink href="/chart">Go to Chart</ContextAwareLink>
 */

const CONTEXT_AWARE_PATHS = ['/search', '/chart'];

export const ContextAwareLink = ({
  href,
  children,
  ...props
}: React.ComponentProps<typeof Link>) => {
  const router = useRouter();
  const { query } = router;

  const [timeRangeQuery] = useQueryParams({
    from: withDefault(NumberParam, -1),
    to: withDefault(NumberParam, -1),
  });

  const [inputTimeQuery] = useQueryParam('tq', withDefault(StringParam, ''), {
    updateType: 'pushIn',
    enableBatching: true,
  });

  const contextAwareHref = useMemo(() => {
    // Only apply context awareness for string hrefs (not object hrefs)
    if (typeof href !== 'string') {
      return href;
    }

    // Extract the path without query params
    const [path] = href.split('?');

    // Only apply context to search and chart pages
    if (!CONTEXT_AWARE_PATHS.includes(path)) {
      return href;
    }

    // Build URL with context
    const params = new URLSearchParams();

    // Carry over time range
    if (timeRangeQuery.from !== -1) {
      params.set('from', timeRangeQuery.from.toString());
    }
    if (timeRangeQuery.to !== -1) {
      params.set('to', timeRangeQuery.to.toString());
    }
    if (inputTimeQuery) {
      params.set('tq', inputTimeQuery);
    }

    // Carry over search context
    if (query.source) {
      params.set('source', query.source as string);
    }
    if (query.where) {
      params.set('where', query.where as string);
    }
    if (query.whereLanguage) {
      params.set('whereLanguage', query.whereLanguage as string);
    }

    const paramsStr = params.toString();
    return paramsStr ? `${path}?${paramsStr}` : path;
  }, [href, query, timeRangeQuery, inputTimeQuery]);

  return (
    <Link href={contextAwareHref} {...props}>
      {children}
    </Link>
  );
};
