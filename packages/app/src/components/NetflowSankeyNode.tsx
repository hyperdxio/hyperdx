import { NodeProps } from 'recharts/types/chart/Sankey';
import { NumericUnit } from '@hyperdx/common-utils/dist/types';
import { Stack, Text, Tooltip } from '@mantine/core';

import {
  NetflowSankeyNode as SankeyNode,
  SankeyFilterHandler,
} from '@/netflowSankey';
import { formatNumber, truncateMiddle } from '@/utils';

import NetflowFilterMenu from './NetflowFilterMenu';

export function NetflowSankeyTooltip({
  label,
  value,
  rangeSeconds,
}: {
  label: string;
  value: number;
  rangeSeconds: number;
}) {
  return (
    <Stack gap={2}>
      <Text size="xs" fw={600} style={{ overflowWrap: 'anywhere' }}>
        {label}
      </Text>
      <Text size="xs">
        Bytes: {formatNumber(value, { output: 'byte', mantissa: 2 })}
      </Text>
      <Text size="xs">
        Average bit rate:{' '}
        {formatNumber((value * 8) / rangeSeconds, {
          output: 'data_rate',
          numericUnit: NumericUnit.BitsSecSI,
          mantissa: 2,
        })}
      </Text>
    </Stack>
  );
}

export default function NetflowSankeyNode({
  node,
  rangeSeconds,
  onFilter,
  color,
  x,
  y,
  width,
  height,
  payload,
}: NodeProps & {
  node: SankeyNode;
  rangeSeconds: number;
  onFilter?: SankeyFilterHandler;
  color: string;
}) {
  const value = Number(payload.value);
  return (
    <NetflowFilterMenu
      label={node.dimension.label}
      value={node.rawValue}
      allowEmpty
      onSelect={
        onFilter &&
        (excluded => onFilter(node.dimension, node.rawValue, excluded))
      }
      target={({ opened, buttonProps }) => (
        <Tooltip
          disabled={opened}
          multiline
          maw={360}
          withArrow
          label={
            <NetflowSankeyTooltip
              label={`${node.dimension.label}: ${node.name}`}
              value={value}
              rangeSeconds={rangeSeconds}
            />
          }
        >
          <g
            {...buttonProps}
            style={{ cursor: onFilter ? 'pointer' : 'default' }}
          >
            <rect
              x={x}
              y={y}
              width={width}
              height={Math.max(height, 1)}
              fill={color}
              rx={2}
            />
            <text
              x={x + width + 8}
              y={y + height / 2}
              dominantBaseline="middle"
              textAnchor="start"
              fontSize={11}
              fill="var(--color-text-primary)"
              stroke="var(--color-bg-body)"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {truncateMiddle(node.name, 26)}
            </text>
          </g>
        </Tooltip>
      )}
    />
  );
}
