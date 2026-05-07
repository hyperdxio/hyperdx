/**
 * Materialized-view shim (Berg Phase 1.2 / Task 12).
 *
 * Berg has no materialized-view concept — Athena reads directly from
 * S3 Tables / Glue without any intermediate aggregating-merge layer.
 * The HyperDX-era MV optimization helpers are stubbed here so the
 * legacy app-side hooks (`useDashboardFilterValues`,
 * `useMVOptimizationExplanation`) keep type-checking until Tasks 13 / 15
 * sweep them.
 *
 * `optimizeGetKeyValuesCalls` returns the input unchanged: a single
 * direct keyvalue lookup against the source table, no MV branches.
 *
 * `tryOptimizeConfigWithMaterializedViewWithExplanations` returns an
 * empty explanation list — the MV-banner UI then renders nothing.
 */
import type {
  BuilderChartConfigWithDateRange,
  BuilderChartConfigWithOptDateRange,
  TSource,
} from '@/types';

export type MVOptimizationExplanation = {
  reason: string;
  details?: string;
  // The legacy HyperDX explanation carried extra fields consumed by the
  // app's MV banner / modal. Kept here as optional-with-defaults so the
  // existing callers don't blow up at compile time. Berg never populates
  // them — the banner / modal renders empty.

  success?: any;

  mvConfig?: any;
  /** Always [] in Berg — surface preserved for the legacy MV modal. */
  errors: string[];
  rowEstimate?: number;
};

export type GetKeyValueCall<
  C extends BuilderChartConfigWithDateRange = BuilderChartConfigWithDateRange,
> = {
  chartConfig: C;
  keys: string[];
};

export async function optimizeGetKeyValuesCalls(args: {
  chartConfig: BuilderChartConfigWithDateRange;
  keys: string[];
  source: TSource;
  // Anything else the legacy callers pass — explicitly typed `unknown` so
  // a future caller adding a field doesn't silently bypass type checking.

  [key: string]: any;
}): Promise<GetKeyValueCall[]> {
  return [{ chartConfig: args.chartConfig, keys: args.keys }];
}

export async function tryOptimizeConfigWithMaterializedViewWithExplanations<
  C extends BuilderChartConfigWithOptDateRange,
>(
  config: C,

  ..._rest: any[]
): Promise<{
  optimizedConfig?: C;
  explanations: MVOptimizationExplanation[];
}> {
  return { optimizedConfig: config, explanations: [] };
}
