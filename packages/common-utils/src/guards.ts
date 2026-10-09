import {
  BuilderChartConfig,
  BuilderSavedChartConfig,
  ChartConfig,
  ChartConfigWithOptDateRange,
  DisplayType,
  HeatmapMode,
  PromqlChartConfig,
  PromqlSavedChartConfig,
  RawSqlChartConfig,
  RawSqlSavedChartConfig,
  SavedChartConfig,
  SourceKind,
  TSource,
} from './types';

/** Source kinds that can back a distribution-mode heatmap tile. */
export const HEATMAP_DISTRIBUTION_SOURCE_KINDS: ReadonlyArray<SourceKind> = [
  SourceKind.Trace,
];

/** Source kinds that can back a series-mode heatmap tile. */
export const HEATMAP_SERIES_SOURCE_KINDS: ReadonlyArray<SourceKind> = [
  SourceKind.Trace,
  SourceKind.Log,
  SourceKind.Metric,
];

export function getHeatmapSourceKinds(
  mode: HeatmapMode = 'distribution',
): ReadonlyArray<SourceKind> {
  return mode === 'series'
    ? HEATMAP_SERIES_SOURCE_KINDS
    : HEATMAP_DISTRIBUTION_SOURCE_KINDS;
}

/**
 * Whether a source can back a heatmap tile in the given mode.
 */
export function isHeatmapCompatibleSource(
  source: Pick<TSource, 'kind'>,
  mode: HeatmapMode = 'distribution',
): boolean {
  return getHeatmapSourceKinds(mode).includes(source.kind);
}

export function isRawSqlChartConfig(
  chartConfig: ChartConfig | ChartConfigWithOptDateRange,
): chartConfig is RawSqlChartConfig {
  return 'configType' in chartConfig && chartConfig.configType === 'sql';
}

export function isPromqlChartConfig(
  chartConfig: ChartConfig | ChartConfigWithOptDateRange,
): chartConfig is PromqlChartConfig {
  return 'configType' in chartConfig && chartConfig.configType === 'promql';
}

export function isBuilderChartConfig(
  chartConfig: ChartConfig | ChartConfigWithOptDateRange,
): chartConfig is BuilderChartConfig {
  return !isRawSqlChartConfig(chartConfig) && !isPromqlChartConfig(chartConfig);
}

export function isRawSqlSavedChartConfig(
  chartConfig: SavedChartConfig,
): chartConfig is RawSqlSavedChartConfig {
  return 'configType' in chartConfig && chartConfig.configType === 'sql';
}

export function isPromqlSavedChartConfig(
  chartConfig: SavedChartConfig,
): chartConfig is PromqlSavedChartConfig {
  return 'configType' in chartConfig && chartConfig.configType === 'promql';
}

export function isBuilderSavedChartConfig(
  chartConfig: SavedChartConfig,
): chartConfig is BuilderSavedChartConfig {
  return (
    !isRawSqlSavedChartConfig(chartConfig) &&
    !isPromqlSavedChartConfig(chartConfig)
  );
}

/**
 * Returns true when a display type semantically requires a data source to be
 * configured. Currently Markdown is the only display type that does not need a
 * source (it renders static content). Add any future sourceless display types
 * here rather than scattering per-type checks across the codebase.
 */
export function displayTypeRequiresSource(
  displayType: DisplayType | undefined,
): boolean {
  return displayType !== DisplayType.Markdown;
}
