import type { ComponentType, ReactNode } from 'react';
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

import classes from './ChartTypeSelector.module.scss';

type ChartTypeOption = {
  value: DisplayType;
  label: string;
  Icon: ComponentType<IconProps>;
};

const PREVIEW_OPTIONS: (ChartTypeOption & {
  preview: ReactNode;
  LivePreview: ComponentType<ChartTypePreviewProps>;
})[] = [
  {
    value: DisplayType.Line,
    label: 'Time series',
    Icon: IconChartLine,
    LivePreview: TimeSeriesPreview,
    preview: (
      <svg
        className={classes.timeSeries}
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
      >
        <polyline
          points="0,30 12,24 24,27 36,16 48,20 60,10 72,14 84,6 100,9"
          stroke="var(--color-chart-blue)"
        />
        <polyline
          points="0,36 12,33 24,34 36,28 48,31 60,25 72,27 84,22 100,24"
          stroke="var(--color-chart-cyan)"
        />
      </svg>
    ),
  },
  {
    value: DisplayType.Table,
    label: 'Table',
    Icon: IconTable,
    LivePreview: TablePreview,
    preview: (
      <div className={classes.miniTable}>
        {[
          ['frontend', '412K'],
          ['checkout', '318K'],
          ['cart', '254K'],
        ].map(([name, count]) => (
          <div key={name} className={classes.miniTableRow}>
            <span>{name}</span>
            <span>{count}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    value: DisplayType.Number,
    label: 'Number',
    Icon: IconNumbers,
    LivePreview: NumberPreview,
    preview: <div className={classes.number}>1.42M</div>,
  },
  {
    value: DisplayType.Bar,
    label: 'Bar',
    Icon: IconChartBar,
    LivePreview: BarPreview,
    preview: (
      <div className={classes.bars}>
        {[48, 37, 30, 22, 17, 12].map(height => (
          <div key={height} className={classes.bar} style={{ height }} />
        ))}
      </div>
    ),
  },
  {
    value: DisplayType.Pie,
    label: 'Pie',
    Icon: IconChartPie,
    LivePreview: PiePreview,
    preview: <div className={classes.pie} />,
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
          ({ value: optionValue, label, Icon, preview, LivePreview }) => (
            <Radio.Card
              key={optionValue}
              value={optionValue}
              withBorder={false}
              className={classes.tile}
            >
              <div className={classes.preview} aria-hidden>
                {config ? (
                  <LivePreview config={config} fallback={preview} />
                ) : (
                  preview
                )}
              </div>
              <div className={classes.label}>
                <Icon size={15} />
                {label}
              </div>
            </Radio.Card>
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
