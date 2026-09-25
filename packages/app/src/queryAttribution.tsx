import { createContext, use, useMemo } from 'react';
import {
  mergeQueryAttribution,
  QueryAttribution,
} from '@hyperdx/common-utils/dist/clickhouse';

/**
 * What the ClickHouse queries below this point belong to.
 * `useClickhouseClient` reads it and tags each query.
 *
 * Providers nest, so a dashboard sets its id once and each tile adds its own.
 *
 * This stays off the chart config on purpose: the config is the React Query
 * cache key, so two pages asking the same question would stop sharing an
 * answer and we would run the query twice.
 */
const QueryAttributionContext = createContext<QueryAttribution>({});

/** What is in effect here. */
export function useQueryAttribution(): QueryAttribution {
  return use(QueryAttributionContext);
}

export function QueryAttributionProvider({
  attribution,
  children,
}: {
  attribution: QueryAttribution;
  children: React.ReactNode;
}) {
  const parent = use(QueryAttributionContext);

  // Callers build `attribution` inline, so it is a new object every render.
  // Comparing the serialized value instead avoids re-rendering every chart
  // below. Serializing beats listing the fields, which we would forget to
  // update when a field is added.
  //
  // The memo reads the string back rather than closing over `attribution`, so
  // its dependencies are the whole truth.
  const attributionKey = JSON.stringify(attribution);
  const merged = useMemo(() => {
    const parsed: QueryAttribution = JSON.parse(attributionKey);
    return mergeQueryAttribution(parent, parsed);
  }, [parent, attributionKey]);

  return (
    <QueryAttributionContext value={merged}>{children}</QueryAttributionContext>
  );
}
