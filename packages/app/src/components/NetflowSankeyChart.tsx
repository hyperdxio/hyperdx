import { ResponsiveContainer, Sankey } from 'recharts';
import { Box, ScrollArea, Text, Tooltip } from '@mantine/core';

import {
  NetflowSankeyData,
  SankeyDimension,
  SankeyFilterHandler,
} from '@/netflowSankey';
import { semanticKeyedColor } from '@/utils';

import NetflowSankeyNode, { NetflowSankeyTooltip } from './NetflowSankeyNode';

const LEFT_MARGIN = 100;
const RIGHT_MARGIN = 200;

export default function NetflowSankeyChart({
  data,
  dimensions,
  rangeSeconds,
  onFilter,
}: {
  data: NetflowSankeyData;
  dimensions: SankeyDimension[];
  rangeSeconds: number;
  onFilter?: SankeyFilterHandler;
}) {
  const stageCounts = dimensions.map(
    (_, stage) => data.nodes.filter(node => node.stage === stage).length,
  );
  const height = Math.max(380, Math.max(...stageCounts, 0) * 26 + 24);

  return (
    <ScrollArea
      h={Math.min(height + 44, 580)}
      type="auto"
      data-testid="netflow-sankey-graph"
    >
      <Box miw={(dimensions.length - 1) * 240 + LEFT_MARGIN + RIGHT_MARGIN}>
        <Box h={32} pos="relative">
          {dimensions.map((dimension, stage) => {
            const ratio = stage / (dimensions.length - 1);
            return (
              <Text
                key={dimension.key}
                size="xs"
                fw={600}
                pos="absolute"
                style={{
                  left: `calc(${ratio * 100}% + ${LEFT_MARGIN * (1 - ratio) - RIGHT_MARGIN * ratio}px)`,
                  transform: 'translateX(-50%)',
                  whiteSpace: 'nowrap',
                }}
              >
                {dimension.label}
              </Text>
            );
          })}
        </Box>
        <Box h={height}>
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            debounce={50}
          >
            <Sankey
              data={data}
              nodeWidth={12}
              nodePadding={18}
              iterations={32}
              sort={false}
              margin={{
                top: 12,
                right: RIGHT_MARGIN,
                bottom: 12,
                left: LEFT_MARGIN,
              }}
              node={props => {
                const node = data.nodes[props.index];
                return (
                  <NetflowSankeyNode
                    {...props}
                    node={node}
                    rangeSeconds={rangeSeconds}
                    onFilter={onFilter}
                    color={semanticKeyedColor(node.id, props.index)}
                  />
                );
              }}
              link={props => {
                const link = data.links[props.index];
                const source = data.nodes[link.source];
                const target = data.nodes[link.target];
                return (
                  <Tooltip
                    multiline
                    maw={360}
                    withArrow
                    label={
                      <NetflowSankeyTooltip
                        label={`${source.name} → ${target.name}`}
                        value={link.value}
                        rangeSeconds={rangeSeconds}
                      />
                    }
                  >
                    <path
                      d={`M${props.sourceX},${props.sourceY} C${props.sourceControlX},${props.sourceY} ${props.targetControlX},${props.targetY} ${props.targetX},${props.targetY}`}
                      fill="none"
                      stroke={semanticKeyedColor(source.id, link.source)}
                      strokeOpacity={0.35}
                      strokeWidth={Math.max(props.linkWidth, 0.5)}
                      aria-label={`${source.name} to ${target.name}`}
                    />
                  </Tooltip>
                );
              }}
            />
          </ResponsiveContainer>
        </Box>
      </Box>
    </ScrollArea>
  );
}
