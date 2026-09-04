import { AlertSource } from '@/models/alert';

const ALERT_NAME_MAX_LENGTH = 512;

function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (tag): tag is string => typeof tag === 'string' && tag !== '',
  );
}

export function deriveAlertNameAndTags(
  alert: {
    source?: unknown;
    tileId?: unknown;
    chartConfig?: { name?: unknown } | null;
  },
  savedSearch: { name?: unknown; tags?: unknown } | undefined,
  dashboard: { name?: unknown; tags?: unknown; tiles?: unknown } | undefined,
): { name: string | null; tags: string[] } {
  const source = alert.source ?? AlertSource.SAVED_SEARCH;

  let name: string | null = null;
  let tags: string[] = [];
  if (source === AlertSource.TILE) {
    const dashboardName = normalizeName(dashboard?.name);
    if (dashboardName != null) {
      const rawTiles = dashboard?.tiles;
      const tiles: { id?: unknown; config?: { name?: unknown } | null }[] =
        Array.isArray(rawTiles) ? rawTiles : [];
      const tile =
        typeof alert.tileId === 'string'
          ? tiles.find(t => t?.id === alert.tileId)
          : undefined;
      name = `${dashboardName} - ${normalizeName(tile?.config?.name) ?? 'Tile'}`;
    }
    tags = normalizeTags(dashboard?.tags);
  } else if (source === AlertSource.INLINE) {
    name = normalizeName(alert.chartConfig?.name);
  } else {
    name = normalizeName(savedSearch?.name);
    tags = normalizeTags(savedSearch?.tags);
  }

  return { name: name?.slice(0, ALERT_NAME_MAX_LENGTH) ?? null, tags };
}
