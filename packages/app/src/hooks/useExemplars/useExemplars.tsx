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
import { quantizeEnd, quantizeStart } from '@/hooks/useExemplars/quantize';
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

/**
 * Fetches exemplars for a chart in parallel with the main series query. A no-op
 * (disabled query) unless `config.enableExemplars` is set and the source kind
 * supports exemplars, so it adds zero cost to charts that don't use the overlay.
 */
export function useExemplars(
  config: ChartConfigWithOptDateRange,
  source: TSource | undefined,
  /**
   * How many series the chart actually draws, from the main query's result.
   *
   * The exemplar response cannot answer this: Prometheus only returns series that
   * carry a sampled exemplar, so a genuinely multi-line chart whose buffer
   * happened to hold one series' worth would look single-series and get markers
   * attributed to a line they may not belong to.
   *
   * An absent or zero count permits the overlay. That is safe rather than
   * deliberate: DBTimeChart does not mount the chart until it has data, so no
   * markers reach the screen while the count is still unknown.
   */
  plottedSeriesCount?: number,
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
  // A marker's y is the trace's own value on the chart's shared axis, so with
  // more than one line drawn there is no way to say which line a marker belongs
  // to. Decided from the rendered series count rather than the exemplar payload —
  // see the parameter's note.
  const tooManySeries = plottedSeriesCount != null && plottedSeriesCount > 1;

  // Everything except the series count: "the user asked for exemplars and this
  // chart could carry them". Kept separate so the multi-series notice can fire
  // without a fetch.
  const wantsExemplars =
    IS_EXEMPLARS_ENABLED &&
    config.enableExemplars === true &&
    supported &&
    promqlEligible;

  // No point paying for a proxy round-trip per window on a chart that can never
  // show the result.
  const enabled = wantsExemplars && !tooManySeries;

  // `config` minus the raw dateRange. This identifies the *chart* — the metric or
  // PromQL expression, filters, connection — independently of the window being
  // viewed, which is what makes it safe to carry a placeholder across a range
  // change but not across a chart change (see placeholderData below).
  const keyConfig = useMemo(
    () => ({ ...config, dateRange: undefined }),
    [config],
  );

  // The window actually fetched, and the window keyed. Must be the same value —
  // see the note on quantizeStart above.
  const fetchRange = useMemo(
    () =>
      config.dateRange
        ? ([
            new Date(quantizeStart(config.dateRange[0])),
            new Date(quantizeEnd(config.dateRange[1])),
          ] as [Date, Date])
        : undefined,
    [config.dateRange],
  );

  const query = useQuery<NormalizedExemplars>({
    // The raw dateRange is replaced by its quantized form so a live-tail tick
    // doesn't invalidate the overlay every second.
    queryKey: ['exemplars', keyConfig, fetchRange?.map(d => d.getTime())],
    queryFn: async context => {
      // PromQL → native Prometheus exemplars via the API proxy.
      if (isPromqlChartConfig(config) && fetchRange) {
        const [startDate, endDate] = fetchRange;
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
        // Same quantized window as the key and the PromQL branch, so one cache
        // entry means one fetched window on both backends.
        fetchRange ? { ...config, dateRange: fetchRange } : config,
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
    exemplars:
      enabled && !tooManySeries
        ? (query.data?.exemplars ?? NO_EXEMPLARS)
        : NO_EXEMPLARS,
    /** The overlay was asked for but suppressed — see ExemplarDropReason. */
    dropped: tooManySeries
      ? wantsExemplars
        ? ('multiple-series' as const)
        : undefined
      : enabled
        ? query.data?.dropped
        : undefined,
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
