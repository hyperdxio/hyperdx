import {
  BuilderChartConfig,
  BuilderSavedChartConfig,
  ChartConfig,
  ChartConfigWithOptDateRange,
  RawSqlChartConfig,
  RawSqlSavedChartConfig,
  SavedChartConfig,
  SourceKind,
  TSource,
} from './types';

/**
 * Source kinds that can back a heatmap tile. The HeatmapSeriesEditor
 * defaults to `Duration` for traces, and the editor's source picker
 * filters with `allowedSourceKinds={[SourceKind.Trace]}` when the
 * selected display type is heatmap (see
 * `packages/app/src/components/DBEditTimeChartForm/ChartEditorControls.tsx`).
 *
 * The external dashboards API uses the same set so UI and API gates
 * move together; expanding heatmap to a new source kind only requires
 * adding it here.
 */
export const HEATMAP_ALLOWED_SOURCE_KINDS: ReadonlyArray<SourceKind> = [
  SourceKind.Trace,
];

/**
 * Whether a source can back a heatmap tile.
 */
export function isHeatmapCompatibleSource(
  source: Pick<TSource, 'kind'>,
): boolean {
  return HEATMAP_ALLOWED_SOURCE_KINDS.includes(source.kind);
}

export function isRawSqlChartConfig(
  chartConfig: ChartConfig | ChartConfigWithOptDateRange,
): chartConfig is RawSqlChartConfig {
  return 'configType' in chartConfig && chartConfig.configType === 'sql';
}

export function isBuilderChartConfig(
  chartConfig: ChartConfig | ChartConfigWithOptDateRange,
): chartConfig is BuilderChartConfig {
  return !isRawSqlChartConfig(chartConfig);
}

export function isRawSqlSavedChartConfig(
  chartConfig: SavedChartConfig,
): chartConfig is RawSqlSavedChartConfig {
  return 'configType' in chartConfig && chartConfig.configType === 'sql';
}

export function isBuilderSavedChartConfig(
  chartConfig: SavedChartConfig,
): chartConfig is BuilderSavedChartConfig {
  return !isRawSqlSavedChartConfig(chartConfig);
}
