import {
  BuilderChartConfig,
  BuilderSavedChartConfig,
  ChartConfig,
  ChartConfigWithOptDateRange,
  DisplayType,
  RawSqlChartConfig,
  RawSqlSavedChartConfig,
  SavedChartConfig,
} from './types';

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
