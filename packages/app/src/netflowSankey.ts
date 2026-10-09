import {
  BuilderChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';

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
  totalBytes: number;
}

export function sankeyDimensionExpression(dimension: SankeyDimension): string {
  return `ifNull(toString(${dimension.expression}), '')`;
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
    alias: `__netflow_dimension_${stage}`,
  }));

  return {
    ...baseConfig,
    select: [
      ...dimensionSelect,
      { ...baseConfig.select[0], alias: '__netflow_value' },
    ],
    groupBy: dimensionSelect.map(dimension => dimension.alias).join(', '),
    orderBy: '__netflow_value DESC',
    limit: {
      limit: Number.isFinite(limit)
        ? Math.min(100, Math.max(1, Math.floor(limit)))
        : 20,
    },
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
    totalBytes: 0,
  };
  if (dimensions.length < 2) return data;

  const nodeIndices = new Map<string, number>();
  const links = new Map<string, NetflowSankeyLink>();
  for (const row of rows) {
    const rawBytes = row.__netflow_value;
    if (typeof rawBytes !== 'number' && typeof rawBytes !== 'string') continue;
    const value = Number(rawBytes);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (
      dimensions.some(
        (_, stage) => !Object.hasOwn(row, `__netflow_dimension_${stage}`),
      )
    )
      continue;

    const values = dimensions.map((_, stage) =>
      String(row[`__netflow_dimension_${stage}`] ?? ''),
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
    data.totalBytes += value;
  }
  data.links = [...links.values()];
  return data;
}
