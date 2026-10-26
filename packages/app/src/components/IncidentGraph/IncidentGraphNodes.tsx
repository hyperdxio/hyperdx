import cx from 'classnames';
import { Group, Text } from '@mantine/core';
import { IconAlertTriangle, IconDatabase } from '@tabler/icons-react';
import { Handle, Node, NodeProps, Position } from '@xyflow/react';

import {
  errorRateColors,
  IncidentNodeData,
  TopologyNodeData,
} from './graphMapping';

import styles from './IncidentGraph.module.scss';

const ROLE_CAPTION = {
  start: 'Alerting',
  target: 'Root cause',
  affected: 'Affected',
} as const;

const hiddenHandles = (
  <>
    <Handle
      type="target"
      position={Position.Left}
      style={{ visibility: 'hidden' }}
    />
    <Handle
      type="source"
      position={Position.Right}
      style={{ visibility: 'hidden' }}
    />
  </>
);

function TopologyNode({ data }: NodeProps<Node<TopologyNodeData, 'topology'>>) {
  const { backgroundColor, borderColor, borderStyle } = errorRateColors(
    data.errorRate,
  );
  return (
    <div className={styles.node}>
      {hiddenHandles}
      <div
        className={cx(styles[data.kind], data.role && styles[data.role], {
          [styles.highlighted]: data.highlighted,
        })}
        style={{ backgroundColor, borderColor, borderStyle }}
      >
        {data.kind === 'datastore' && <IconDatabase size={18} />}
      </div>
      <Text size="xxs">{data.label}</Text>
      {data.role && (
        <Text size="xxs" fw={600} className={styles[`${data.role}Caption`]}>
          {ROLE_CAPTION[data.role]}
        </Text>
      )}
    </div>
  );
}

function IncidentNode({ data }: NodeProps<Node<IncidentNodeData, 'incident'>>) {
  const { incident, highlighted } = data;
  return (
    <div
      className={cx(styles.incident, {
        [styles.unconfirmed]: !incident.confirmed,
        [styles.highlighted]: highlighted,
      })}
    >
      {hiddenHandles}
      <Group gap={4} wrap="nowrap">
        <IconAlertTriangle size={14} color="var(--color-text-danger)" />
        <Text size="xs" fw={500} lineClamp={1}>
          {incident.title}
        </Text>
      </Group>
      {!incident.confirmed && (
        <Text size="xxs" c="dimmed">
          Not confirmed
        </Text>
      )}
    </div>
  );
}

export const nodeTypes = { topology: TopologyNode, incident: IncidentNode };
