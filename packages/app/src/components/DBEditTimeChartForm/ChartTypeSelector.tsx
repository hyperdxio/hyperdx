import type { ComponentType } from 'react';
import { isTimeSeriesDisplayType } from '@hyperdx/common-utils/dist/core/utils';
import {
  ChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';
import { Radio } from '@mantine/core';
import {
  IconBracketsContain,
  IconChartBar,
  IconChartLine,
  IconChartPie,
  IconGrid3x3,
  IconList,
  IconMarkdown,
  IconNumbers,
  type IconProps,
  IconTable,
} from '@tabler/icons-react';

import {
  BarPreview,
  type ChartTypePreviewProps,
  NumberPreview,
  PiePreview,
  TablePreview,
  TimeSeriesPreview,
} from './ChartTypePreviews';
import {
  SampleBar,
  SampleNumber,
  SamplePie,
  SampleTable,
  SampleTimeSeries,
} from './ChartTypeThumbnails';

import classes from './ChartTypeSelector.module.scss';

type ChartTypeOption = {
  value: DisplayType;
  label: string;
  Icon: ComponentType<IconProps>;
};

const PREVIEW_OPTIONS: (ChartTypeOption & {
  Sample: ComponentType;
  LivePreview: ComponentType<ChartTypePreviewProps>;
})[] = [
  {
    value: DisplayType.Line,
    label: 'Time series',
    Icon: IconChartLine,
    Sample: SampleTimeSeries,
    LivePreview: TimeSeriesPreview,
  },
  {
    value: DisplayType.Table,
    label: 'Table',
    Icon: IconTable,
    Sample: SampleTable,
    LivePreview: TablePreview,
  },
  {
    value: DisplayType.Number,
    label: 'Number',
    Icon: IconNumbers,
    Sample: SampleNumber,
    LivePreview: NumberPreview,
  },
  {
    value: DisplayType.Bar,
    label: 'Bar',
    Icon: IconChartBar,
    Sample: SampleBar,
    LivePreview: BarPreview,
  },
  {
    value: DisplayType.Pie,
    label: 'Pie',
    Icon: IconChartPie,
    Sample: SamplePie,
    LivePreview: PiePreview,
  },
];

const COMPACT_OPTIONS: ChartTypeOption[] = [
  { value: DisplayType.Search, label: 'Search', Icon: IconList },
  { value: DisplayType.Heatmap, label: 'Heatmap', Icon: IconGrid3x3 },
  {
    value: DisplayType.EventPatterns,
    label: 'Patterns',
    Icon: IconBracketsContain,
  },
  { value: DisplayType.Markdown, label: 'Markdown', Icon: IconMarkdown },
];

export function ChartTypeSelector({
  value,
  onChange,
  config,
}: {
  value: DisplayType | undefined;
  onChange: (value: DisplayType) => void;
  /** The queried tile, drawn in each preview once its result is cached. */
  config?: ChartConfigWithDateRange;
}) {
  return (
    <Radio.Group
      // Stacked variants are picked from the preview's display switcher and
      // live under the time series option.
      value={value && isTimeSeriesDisplayType(value) ? DisplayType.Line : value}
      onChange={v => {
        if (v === DisplayType.Line && value && isTimeSeriesDisplayType(value))
          return;
        onChange(v as DisplayType);
      }}
      mb="md"
      data-testid="chart-type-input"
    >
      <div className={classes.grid}>
        {PREVIEW_OPTIONS.map(
          ({ value: optionValue, label, Icon, Sample, LivePreview }) => (
            // The preview sits beside the radio, not inside it, because the
            // real charts render buttons and buttons can't nest. The radio's
            // ::after covers the tile so all of it stays clickable.
            <div key={optionValue} className={classes.tile}>
              <div
                className={classes.preview}
                data-testid={`chart-type-preview-${optionValue}`}
                inert
              >
                {config ? (
                  <LivePreview config={config} fallback={<Sample />} />
                ) : (
                  <Sample />
                )}
              </div>
              <Radio.Card
                value={optionValue}
                withBorder={false}
                className={classes.label}
              >
                <Icon size={15} />
                {label}
              </Radio.Card>
            </div>
          ),
        )}
        <div className={classes.compactList}>
          {COMPACT_OPTIONS.map(({ value: optionValue, label, Icon }) => (
            <Radio.Card
              key={optionValue}
              value={optionValue}
              withBorder={false}
              className={classes.compactItem}
            >
              <Icon size={15} />
              {label}
            </Radio.Card>
          ))}
        </div>
      </div>
    </Radio.Group>
  );
}
