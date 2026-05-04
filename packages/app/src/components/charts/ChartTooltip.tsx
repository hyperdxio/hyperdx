import { memo } from 'react';
import { IconCaretDownFilled, IconCaretUpFilled } from '@tabler/icons-react';

import type { NumberFormat } from '@/types';
import { formatNumber, truncateMiddle } from '@/utils';

import styles from '../../../styles/HDXLineChart.module.scss';

const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 2,
});

const calculatePercentChange = (current: number, previous: number) => {
  if (previous === 0) {
    return current === 0 ? 0 : undefined;
  }
  return (current - previous) / previous;
};

const PercentChange = ({
  current,
  previous,
}: {
  current: number;
  previous: number;
}) => {
  const percentChange = calculatePercentChange(current, previous);
  if (percentChange == undefined) {
    return null;
  }

  const Icon = percentChange > 0 ? IconCaretUpFilled : IconCaretDownFilled;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 0 }}>
      (<Icon size={12} />
      {percentFormatter.format(Math.abs(percentChange))})
    </span>
  );
};

export const ChartTooltipItem = memo(
  ({
    color,
    name,
    value,
    numberFormat,
    indicator = 'line',
    strokeDasharray,
    opacity,
    previous,
  }: {
    color: string;
    name: string;
    value: number;
    numberFormat?: NumberFormat;
    indicator?: 'line' | 'square' | 'none';
    strokeDasharray?: string;
    opacity?: number;
    previous?: number;
  }) => {
    return (
      <div className="d-flex gap-2 items-center justify-center">
        <div>
          {indicator === 'square' ? (
            <svg width="12" height="12">
              <rect width="12" height="12" fill={color} rx="2" />
            </svg>
          ) : indicator === 'line' ? (
            <svg width="12" height="4">
              <line
                x1="0"
                y1="2"
                x2="12"
                y2="2"
                stroke={color}
                opacity={opacity}
                strokeDasharray={strokeDasharray}
              />
            </svg>
          ) : null}
        </div>
        <div>
          <span style={{ color }}>{truncateMiddle(name, 50)}</span>
          {': '}
          {numberFormat ? formatNumber(value, numberFormat) : value}{' '}
          {previous != null && (
            <PercentChange current={value} previous={previous} />
          )}
        </div>
      </div>
    );
  },
);

export const ChartTooltipContainer = ({
  header,
  children,
}: {
  header?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div className={styles.chartTooltip}>
    {header != null && (
      <div className={styles.chartTooltipHeader}>{header}</div>
    )}
    <div className={styles.chartTooltipContent}>{children}</div>
  </div>
);
