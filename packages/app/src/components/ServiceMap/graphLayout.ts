import dagre from '@dagrejs/dagre';
import { Edge, Node, Position } from '@xyflow/react';

// rankSep widens the gap between columns, for edges that carry labels.
export function getGraphLayout<N extends Node>(
  nodes: N[],
  edges: Edge[],
  rankSep?: number,
): N[] {
  const NODE_SIZE = 80;

  const dagreGraph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: 'LR', ...(rankSep && { ranksep: rankSep }) });

  for (const node of nodes) {
    dagreGraph.setNode(node.id, { width: NODE_SIZE, height: NODE_SIZE / 2 });
  }

  for (const edge of edges) {
    dagreGraph.setEdge(edge.source, edge.target);
  }

  dagre.layout(dagreGraph);

  return nodes.map(node => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      targetPosition: Position.Left,
      sourcePosition: Position.Right,
      position: {
        x: nodeWithPosition.x - NODE_SIZE / 2,
        y: nodeWithPosition.y - NODE_SIZE / 2,
      },
    };
  });
}
