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

const CONTEXT_AWARE_PATHS = ['/search', '/chart'];

const CONTEXT_PARAMS = ['source', 'where', 'whereLanguage'] as const;

type ContextParams = {
  from: number;
  to: number;
  tq: string;
  source?: string;
  where?: string;
  whereLanguage?: string;
};

const buildContextAwareUrl = (href: string, context: ContextParams): string => {
  const [path] = href.split('?');

  if (!CONTEXT_AWARE_PATHS.includes(path)) {
    return href;
  }

  const params = new URLSearchParams();

  if (context.from !== -1) {
    params.set('from', context.from.toString());
  }
  if (context.to !== -1) {
    params.set('to', context.to.toString());
  }
  if (context.tq) {
    params.set('tq', context.tq);
  }

  CONTEXT_PARAMS.forEach(key => {
    const value = context[key];
    if (value) {
      params.set(key, value);
    }
  });

  const paramsStr = params.toString();
  return paramsStr ? `${path}?${paramsStr}` : path;
};

export const ContextAwareLink = ({
  href,
  children,
  ...props
}: React.ComponentProps<typeof Link>) => {
  const { query } = useRouter();

  const [timeRangeQuery] = useQueryParams({
    from: withDefault(NumberParam, -1),
    to: withDefault(NumberParam, -1),
  });

  const [inputTimeQuery] = useQueryParam('tq', withDefault(StringParam, ''), {
    updateType: 'pushIn',
    enableBatching: true,
  });

  const contextAwareHref = useMemo(() => {
    if (typeof href !== 'string') {
      return href;
    }

    const context: ContextParams = {
      from: timeRangeQuery.from,
      to: timeRangeQuery.to,
      tq: inputTimeQuery,
      source: query.source as string | undefined,
      where: query.where as string | undefined,
      whereLanguage: query.whereLanguage as string | undefined,
    };

    return buildContextAwareUrl(href, context);
  }, [href, query, timeRangeQuery, inputTimeQuery]);

  return (
    <Link href={contextAwareHref} {...props}>
      {children}
    </Link>
  );
};
