import { memo } from 'react';

import { ChartTooltipItem } from '@/components/charts/ChartTooltip';
import type { NumberFormat } from '@/types';

export type TooltipPayload = {
  dataKey: string;
  name: string;
  value: number;
  color?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  opacity?: number;
};

export const TooltipItem = memo(
  ({
    p,
    previous,
    numberFormat,
    highlighted,
    dimmed,
  }: {
    p: TooltipPayload;
    previous?: TooltipPayload;
    numberFormat?: NumberFormat;
    highlighted?: boolean;
    dimmed?: boolean;
  }) => {
    return (
      <ChartTooltipItem
        color={p.color ?? ''}
        name={p.name ?? p.dataKey}
        value={p.value}
        numberFormat={numberFormat}
        indicator="line"
        strokeDasharray={p.strokeDasharray}
        opacity={p.opacity}
        previous={previous?.value}
        highlighted={highlighted}
        dimmed={dimmed}
      />
    );
  },
);
