/**
 * Build a tree from trace spans and (optionally) correlated log events.
 *
 * This is a direct port of the web frontend's DBTraceWaterfallChart
 * DAG builder. Do NOT modify without checking DBTraceWaterfallChart first.
 *
 * Mirrors the web frontend's logic:
 * - All rows (traces + logs) are merged and sorted by timestamp
 * - Single pass builds the tree:
 *   - Trace spans use ParentSpanId for parent-child
 *   - Log events use `SpanId-log` as their node key and attach to
 *     the trace span with matching SpanId
 * - Placeholder mechanism: if a child arrives before its parent,
 *   a placeholder is created; when the parent arrives it inherits
 *   the placeholder's children
 * - Children appear in insertion order (already chronological
 *   because input is time-sorted), so DFS produces a timeline
 */

import type { TaggedSpanRow, SpanNode } from './types';

export function buildTree(
  traceSpans: TaggedSpanRow[],
  logEvents: TaggedSpanRow[],
): SpanNode[] {
  const validSpanIds = new Set(
    traceSpans.filter(s => s.SpanId).map(s => s.SpanId),
  );

  const rootNodes: SpanNode[] = [];
  const nodesMap = new Map<string, SpanNode>(); // Maps nodeId → Node
  const spanIdMap = new Map<string, string>(); // Maps SpanId → nodeId of FIRST node

  // Merge and sort by timestamp (matches web frontend)
  const allRows: TaggedSpanRow[] = [...traceSpans, ...logEvents];
  allRows.sort(
    (a, b) => new Date(a.Timestamp).getTime() - new Date(b.Timestamp).getTime(),
  );

  let idCounter = 0;
  for (const row of allRows) {
    const { kind, SpanId, ParentSpanId } = row;
    if (!SpanId) continue;

    const nodeSpanId = kind === 'log' ? `${SpanId}-log` : SpanId;
    const nodeParentSpanId = kind === 'log' ? SpanId : ParentSpanId || '';

    const nodeId = `n-${idCounter++}`;
    const curNode: SpanNode = { ...row, children: [], level: 0 };

    if (kind === 'span') {
      if (!spanIdMap.has(nodeSpanId)) {
        spanIdMap.set(nodeSpanId, nodeId);

        // Inherit children from placeholder if one was created earlier
        const placeholderId = `placeholder-${nodeSpanId}`;
        const placeholder = nodesMap.get(placeholderId);
        if (placeholder) {
          curNode.children = placeholder.children || [];
          nodesMap.delete(placeholderId);
        }
      }
      // Always add to nodesMap with unique nodeId
      nodesMap.set(nodeId, curNode);
    }

    const isRootNode =
      kind === 'span' &&
      (!nodeParentSpanId || !validSpanIds.has(nodeParentSpanId));

    if (isRootNode) {
      rootNodes.push(curNode);
    } else {
      const parentNodeId = spanIdMap.get(nodeParentSpanId);
      let parentNode = parentNodeId ? nodesMap.get(parentNodeId) : undefined;

      if (!parentNode) {
        const placeholderId = `placeholder-${nodeParentSpanId}`;
        parentNode = nodesMap.get(placeholderId);
        if (!parentNode) {
          parentNode = { children: [] } as unknown as SpanNode;
          nodesMap.set(placeholderId, parentNode);
        }
      }

      parentNode.children.push(curNode);
    }
  }

  // Flatten via in-order DFS traversal
  const flattenNode = (node: SpanNode, result: SpanNode[], level: number) => {
    node.level = level;
    result.push(node);
    for (const child of node.children) {
      flattenNode(child, result, level + 1);
    }
  };

  const flattened: SpanNode[] = [];
  for (const root of rootNodes) {
    flattenNode(root, flattened, 0);
  }

  return flattened;
}
