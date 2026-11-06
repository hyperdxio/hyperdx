import {
  BuilderChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';

import { NETFLOW_ALIASES, netflowColumnAlias } from '@/netflow';

export interface SankeyDimension {
  key: string;
  label: string;
  expression: string;
}

export type SankeyFilterHandler = (
  dimension: SankeyDimension,
  value: string,
  excluded: boolean,
) => void;

export interface NetflowSankeyNode {
  id: string;
  name: string;
  rawValue: string;
  stage: number;
  dimension: SankeyDimension;
}

interface NetflowSankeyLink {
  source: number;
  target: number;
  value: number;
}

export interface NetflowSankeyData {
  nodes: NetflowSankeyNode[];
  links: NetflowSankeyLink[];
  paths: { values: string[]; value: number }[];
}

export function sankeyDimensionExpression(dimension: SankeyDimension): string {
  return `ifNull(toString(${dimension.expression}), '')`;
}

export function unwrapSankeyDimensionExpression(expression: string): string {
  return expression.replace(/^ifNull\(toString\((.*)\), ''\)$/s, '$1');
}

export function normalizeNetflowSankeyLimit(limit: number): number {
  return [10, 20, 50].includes(limit) ? limit : 20;
}

export function buildNetflowSankeyConfig({
  baseConfig,
  dimensions,
  limit = 20,
}: {
  baseConfig: BuilderChartConfigWithDateRange;
  dimensions: SankeyDimension[];
  limit?: number;
}): BuilderChartConfigWithDateRange {
  if (dimensions.length < 2 || dimensions.some(d => !d.expression.trim())) {
    throw new Error('Choose at least two dimensions with valid expressions');
  }
  if (!Array.isArray(baseConfig.select) || baseConfig.select.length !== 1) {
    throw new Error('A Sankey query requires one sampled byte aggregate');
  }

  const dimensionSelect = dimensions.map((dimension, stage) => ({
    valueExpression: sankeyDimensionExpression(dimension),
    alias: netflowColumnAlias(`dimension_${stage}`),
  }));

  return {
    ...baseConfig,
    select: [
      ...dimensionSelect,
      { ...baseConfig.select[0], alias: NETFLOW_ALIASES.value },
    ],
    groupBy: dimensionSelect.map(dimension => dimension.alias).join(', '),
    orderBy: `${NETFLOW_ALIASES.value} DESC`,
    limit: { limit: normalizeNetflowSankeyLimit(limit) },
    displayType: DisplayType.Table,
  };
}

export function buildNetflowSankeyData(
  rows: Record<string, unknown>[],
  dimensions: SankeyDimension[],
): NetflowSankeyData {
  const data: NetflowSankeyData = {
    nodes: [],
    links: [],
    paths: [],
  };
  if (dimensions.length < 2) return data;

  const nodeIndices = new Map<string, number>();
  const links = new Map<string, NetflowSankeyLink>();
  for (const row of rows) {
    const rawBytes = row[NETFLOW_ALIASES.value];
    if (typeof rawBytes !== 'number' && typeof rawBytes !== 'string') continue;
    const value = Number(rawBytes);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (
      dimensions.some(
        (_, stage) =>
          !Object.hasOwn(row, netflowColumnAlias(`dimension_${stage}`)),
      )
    )
      continue;

    const values = dimensions.map((_, stage) =>
      String(row[netflowColumnAlias(`dimension_${stage}`)] ?? ''),
    );
    const pathNodes = values.map((rawValue, stage) => {
      // Stage-qualified IDs keep repeated values in different dimensions acyclic.
      const id = JSON.stringify([stage, rawValue]);
      const existing = nodeIndices.get(id);
      if (existing !== undefined) return existing;
      const index = data.nodes.length;
      nodeIndices.set(id, index);
      data.nodes.push({
        id,
        name: rawValue || '(empty)',
        rawValue,
        stage,
        dimension: dimensions[stage],
      });
      return index;
    });
    for (let stage = 1; stage < pathNodes.length; stage++) {
      const source = pathNodes[stage - 1];
      const target = pathNodes[stage];
      const key = `${source}:${target}`;
      const link = links.get(key);
      if (link) link.value += value;
      else links.set(key, { source, target, value });
    }
    data.paths.push({ values, value });
  }
  data.links = [...links.values()];
  return data;
}
