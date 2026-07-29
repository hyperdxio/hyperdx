import { useMemo } from 'react';
import { isEqual } from 'lodash';
import {
  isPromqlExemplarEligible,
  renderMetricExemplarsChartConfig,
} from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { isPromqlChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  ChartConfigWithOptDateRange,
  Exemplar,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { useQuery } from '@tanstack/react-query';

import { prometheusApi } from '@/api';
import { useClickhouseClient } from '@/clickhouse';
import { IS_EXEMPLARS_ENABLED } from '@/config';
import {
  capExemplarsPerBucket,
  mapClickhouseExemplars,
  type NormalizedExemplars,
  normalizePrometheusExemplars,
} from '@/hooks/useExemplars/exemplarNormalize';
import { useMetadataWithSettings } from '@/hooks/useMetadata';

// Source kinds that can produce exemplars today: native metric/promql sources.
// Trace-generated exemplars are added in a follow-up.
const EXEMPLAR_SUPPORTED_KINDS: SourceKind[] = [
  SourceKind.Metric,
  SourceKind.Promql,
];

// Stable identity for "no exemplars". DBTimeChart forwards this straight into
// memo(MemoChart)'s props, so a fresh [] on every render would fail the shallow
// compare and re-render recharts for every time chart in the app on any parent
// state change — including with the feature flag off.
const NO_EXEMPLARS: Exemplar[] = [];

// The exemplar overlay is a coarse annotation layer, not the series itself, so it
// tolerates being a little stale in exchange for not refiring on every mount.
const EXEMPLAR_STALE_TIME_MS = 60_000;

// Live-tail charts advance `dateRange` continuously. Rounding the range in the
// query key to this bucket keeps sub-minute ticks on one cache entry — without
// it every tick mints a new key, empties the overlay, and force-closes the hover
// card the user is reaching for.
const EXEMPLAR_KEY_QUANTUM_MS = 30_000;

const quantize = (d: Date) =>
  Math.round(d.getTime() / EXEMPLAR_KEY_QUANTUM_MS) * EXEMPLAR_KEY_QUANTUM_MS;

/**
 * Fetches exemplars for a chart in parallel with the main series query. A no-op
 * (disabled query) unless `config.enableExemplars` is set and the source kind
 * supports exemplars, so it adds zero cost to charts that don't use the overlay.
 */
export function useExemplars(
  config: ChartConfigWithOptDateRange,
  source: TSource | undefined,
) {
  const clickhouseClient = useClickhouseClient();
  const metadata = useMetadataWithSettings();

  const isPromql = isPromqlChartConfig(config);
  const supported = !!source && EXEMPLAR_SUPPORTED_KINDS.includes(source.kind);
  // A PromQL expression only carries exemplars when it plots a duration — see
  // isPromqlExemplarEligible. Same rule the PromQL editor gates its toggle on, so
  // a config saved before the rule tightened (or written via the API) doesn't
  // plot duration markers on a requests/sec axis.
  const promqlEligible =
    !isPromql || isPromqlExemplarEligible(config.promqlExpression);
  // Global feature gate: even a config with enableExemplars set fetches nothing
  // while the feature is disabled for the deployment.
  const enabled =
    IS_EXEMPLARS_ENABLED &&
    config.enableExemplars === true &&
    supported &&
    promqlEligible;

  // `config` minus the raw dateRange. This identifies the *chart* — the metric or
  // PromQL expression, filters, connection — independently of the window being
  // viewed, which is what makes it safe to carry a placeholder across a range
  // change but not across a chart change (see placeholderData below).
  const keyConfig = useMemo(
    () => ({ ...config, dateRange: undefined }),
    [config],
  );

  const query = useQuery<NormalizedExemplars>({
    // The raw dateRange is replaced by its quantized form so a live-tail tick
    // doesn't invalidate the overlay every second.
    queryKey: ['exemplars', keyConfig, config.dateRange?.map(quantize)],
    queryFn: async context => {
      // PromQL → native Prometheus exemplars via the API proxy.
      if (isPromqlChartConfig(config) && config.dateRange) {
        const [startDate, endDate] = config.dateRange;
        const resp = await prometheusApi.queryExemplars(
          {
            query: config.promqlExpression,
            start: startDate.getTime() / 1000,
            end: endDate.getTime() / 1000,
            connectionId: config.connection,
            database: config.from?.databaseName,
            table: config.from?.tableName,
          },
          context.signal,
        );
        if (resp.status !== 'success') {
          throw new Error(resp.error ?? 'query_exemplars failed');
        }
        const { exemplars, dropped } = normalizePrometheusExemplars(
          resp.data,
          config.promqlExpression,
        );
        // Native Prometheus /query_exemplars has no result-limit parameter, so
        // bound the set client-side to keep an unbounded upstream response from
        // ballooning downstream thinning/render work.
        const all = [...exemplars].sort((a, b) => a.timestamp - b.timestamp);
        return {
          exemplars: capExemplarsPerBucket(all, startDate, endDate),
          dropped,
        };
      }

      // Structured metric source → exemplars stored on the OTel metric table.
      const exemplarSql = await renderMetricExemplarsChartConfig(
        config,
        metadata,
      );
      if (!exemplarSql) return { exemplars: [] };

      const resp = await clickhouseClient.query({
        query: exemplarSql.sql,
        query_params: exemplarSql.params,
        format: 'JSON',
        abort_signal: context.signal,
        connectionId: config.connection,
      });
      const json = await resp.json<Record<string, any>>();
      return { exemplars: mapClickhouseExemplars(json.data ?? []) };
    },
    enabled,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: EXEMPLAR_STALE_TIME_MS,
    // Keep the previous overlay visible across a *time-range* key change (a
    // live-tail tick or a range nudge) instead of blanking it — the main series
    // query does the same, and blanking here would also force-close an open hover
    // card.
    //
    // Scoped to the same chart on purpose. TanStack keeps its last-defined-data on
    // the observer instance, which outlives a key change, so an unscoped
    // `prev => prev` hands the PREVIOUS metric's exemplars to the new chart: real,
    // clickable trace ids, clamped onto the new axes, while isLoading/isError both
    // report settled. The user clicks a marker and lands on an unrelated trace.
    // Comparing the chart identity means a genuine chart switch blanks the overlay
    // (correct) while a range tick keeps it (the point of the placeholder).
    placeholderData: (prev, prevQuery) =>
      isEqual(prevQuery?.queryKey?.[1], keyConfig) ? prev : undefined,
  });

  return {
    exemplars: enabled ? (query.data?.exemplars ?? NO_EXEMPLARS) : NO_EXEMPLARS,
    /** Exemplars were found but suppressed — see ExemplarDropReason. */
    dropped: enabled ? query.data?.dropped : undefined,
    isLoading: query.isLoading,
    isError: query.isError,
    /**
     * The upstream failure message, when there is one. Surfaced verbatim because
     * the API phrases these actionably (e.g. the /query_exemplars window bound
     * tells the user to narrow the chart's range), and a generic "could not load"
     * would throw that guidance away.
     */
    error: query.error instanceof Error ? query.error.message : undefined,
  };
}
