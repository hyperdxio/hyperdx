import { METRIC_QUANTITIES, MetricQuantity } from './classifyMetric';
import {
  matchesMetricQuery,
  MetricQueryToken,
  ParsedMetricQuery,
} from './parseMetricQuery';
import { MetricFilterClause } from './tileDefaults';
import { ENTITY_KEYS, WallMetric } from './useMetricWallCatalog';

export type WallGrouping = 'entity' | 'quantity' | 'flat';

export type WallItem = {
  /** Unique within the wall: the metric plus who it is scoped to. */
  key: string;
  metric: WallMetric;
  entity?: MetricFilterClause;
};

export type WallBand = {
  quantity: MetricQuantity | 'all';
  items: WallItem[];
};

export type WallSection = {
  id: string;
  entity?: MetricFilterClause;
  metricCount: number;
  bands: WallBand[];
};

export function wallItemKey(metricId: string, entity?: MetricFilterClause) {
  return entity ? `${metricId}|${entity.key}=${entity.value}` : metricId;
}

function isEntityToken(
  token: MetricQueryToken,
): token is Extract<MetricQueryToken, { type: 'attr' }> {
  return (
    token.type === 'attr' &&
    (ENTITY_KEYS as readonly string[]).includes(token.key)
  );
}

function band(items: WallItem[]): WallBand[] {
  return METRIC_QUANTITIES.flatMap(quantity => {
    const inBand = items
      .filter(i => i.metric.classification.quantity === quantity)
      .sort((a, b) => a.metric.name.localeCompare(b.metric.name));
    return inBand.length > 0 ? [{ quantity, items: inBand }] : [];
  });
}

/**
 * Lay the matching metrics out as the wall: by entity then quantity band, by
 * band alone, or one flat list. Entity filters in the query pick sections,
 * since the wall already knows who reports what.
 */
export function groupWallMetrics(
  metrics: WallMetric[],
  query: ParsedMetricQuery,
  grouping: WallGrouping,
): WallSection[] {
  const matching = metrics.filter(metric =>
    matchesMetricQuery(
      {
        ...metric,
        quantity: metric.classification.quantity,
        hasKey: key =>
          metric.keys.has(key) || metric.entities.some(e => e.key === key),
      },
      query,
    ),
  );

  if (grouping === 'flat') {
    const items = matching
      .map(metric => ({ key: metric.id, metric }))
      .sort((a, b) => a.metric.name.localeCompare(b.metric.name));
    return items.length > 0
      ? [
          {
            id: 'all',
            metricCount: items.length,
            bands: [{ quantity: 'all', items }],
          },
        ]
      : [];
  }

  if (grouping === 'quantity') {
    const bands = band(matching.map(metric => ({ key: metric.id, metric })));
    return bands.length > 0
      ? [{ id: 'all', metricCount: matching.length, bands }]
      : [];
  }

  const entityTokens = query.tokens.filter(isEntityToken);
  const byEntity = new Map<string, WallItem[]>();
  const unscoped: WallItem[] = [];
  for (const metric of matching) {
    const entities = metric.entities.filter(entity =>
      entityTokens.every(t => t.key !== entity.key || t.value === entity.value),
    );
    if (metric.entities.length === 0 && entityTokens.length === 0) {
      unscoped.push({ key: metric.id, metric });
    }
    for (const entity of entities) {
      const id = `${entity.key}=${entity.value}`;
      const list = byEntity.get(id) ?? [];
      list.push({ key: wallItemKey(metric.id, entity), metric, entity });
      byEntity.set(id, list);
    }
  }

  const sections: WallSection[] = Array.from(byEntity, ([id, items]) => ({
    id,
    entity: items[0].entity,
    metricCount: items.length,
    bands: band(items),
  })).sort((a, b) => b.metricCount - a.metricCount || a.id.localeCompare(b.id));
  if (unscoped.length > 0) {
    sections.push({
      id: 'unscoped',
      metricCount: unscoped.length,
      bands: band(unscoped),
    });
  }
  return sections;
}
