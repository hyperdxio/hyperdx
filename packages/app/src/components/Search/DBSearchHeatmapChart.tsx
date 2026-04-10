import { parseAsFloat, parseAsString, useQueryStates } from 'nuqs';
import {
  BuilderChartConfigWithDateRange,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';

import DBHeatmapWithDeltasChart from '@/components/DBHeatmapWithDeltasChart';
import { getDurationMsExpression } from '@/source';

import type { AddFilterFn } from '../DBDeltaChart';

export function DBSearchHeatmapChart({
  chartConfig,
  source,
  isReady,
  onAddFilter,
}: {
  chartConfig: BuilderChartConfigWithDateRange;
  source: TTraceSource;
  isReady: boolean;
  onAddFilter?: AddFilterFn;
}) {
  const [fields, setFields] = useQueryStates({
    value: parseAsString.withDefault(getDurationMsExpression(source)),
    count: parseAsString.withDefault('count()'),
    scaleType: parseAsString.withDefault('log'),
    // Heatmap selection coordinates
    xMin: parseAsFloat,
    xMax: parseAsFloat,
    yMin: parseAsFloat,
    yMax: parseAsFloat,
  });

  return (
    <DBHeatmapWithDeltasChart
      chartConfig={chartConfig}
      source={source}
      isReady={isReady}
      valueExpression={fields.value}
      countExpression={fields.count}
      scaleType={fields.scaleType === 'linear' ? 'linear' : 'log'}
      selection={{
        xMin: fields.xMin,
        xMax: fields.xMax,
        yMin: fields.yMin,
        yMax: fields.yMax,
      }}
      onSelectionChange={nextSelection => {
        void setFields({
          xMin: nextSelection.xMin ?? null,
          xMax: nextSelection.xMax ?? null,
          yMin: nextSelection.yMin ?? null,
          yMax: nextSelection.yMax ?? null,
        });
      }}
      onSettingsChange={settings => {
        void setFields({
          value: settings.valueExpression,
          count: settings.countExpression ?? '',
          scaleType: settings.scaleType,
        });
      }}
      onAddFilter={onAddFilter as AddFilterFn | undefined}
    />
  );
}
