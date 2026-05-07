import RGL from 'react-grid-layout';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { isBuilderSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  AlertState,
  DashboardContainer as DashboardContainerSchema,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import { Dashboard, type Tile } from '@/dashboard';
import { getMetricTableName } from '@/utils';

import { MoveTarget } from './types';

export const tileToLayoutItem = (chart: Tile): RGL.Layout => ({
  i: chart.id,
  x: chart.x,
  y: chart.y,
  w: chart.w,
  h: chart.h,
  minH: 1,
  minW: 1,
});

export const updateLayout = (newLayout: RGL.Layout[]) => {
  return (dashboard: Dashboard) => {
    for (const chart of dashboard.tiles) {
      const newChartLayout = newLayout.find(layout => layout.i === chart.id);
      if (newChartLayout) {
        chart.x = newChartLayout.x;
        chart.y = newChartLayout.y;
        chart.w = newChartLayout.w;
        chart.h = newChartLayout.h;
      }
    }
  };
};

export function hasLayoutChanged({
  currentLayout,
  newLayout,
}: {
  currentLayout: RGL.Layout[];
  newLayout: RGL.Layout[];
}) {
  if (newLayout.length !== currentLayout.length) {
    return true;
  }

  for (const curr of newLayout) {
    const old = currentLayout.find(l => l.i === curr.i);
    if (
      old?.x !== curr.x ||
      old?.y !== curr.y ||
      old?.h !== curr.h ||
      old?.w !== curr.w
    ) {
      return true;
    }
  }

  return false;
}

export function downloadObjectAsJson(object: object, fileName = 'output') {
  const dataStr =
    'data:text/json;charset=utf-8,' +
    encodeURIComponent(JSON.stringify(object));
  const downloadAnchorNode = document.createElement('a');
  downloadAnchorNode.setAttribute('href', dataStr);
  downloadAnchorNode.setAttribute('download', fileName + '.json');
  document.body.appendChild(downloadAnchorNode); // required for firefox
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
}

export function getDashboardTableConnections({
  dashboard,
  sources,
}: {
  dashboard: Dashboard | undefined;
  sources: TSource[] | undefined;
}): TableConnection[] {
  if (!dashboard) return [];
  const tableConnections: TableConnection[] = [];

  for (const { config } of dashboard.tiles) {
    if (!isBuilderSavedChartConfig(config)) continue;
    const source = sources?.find(v => v.id === config.source);
    if (!source) continue;
    // TODO: will need to update this when we allow for multiple metrics per chart
    const firstSelect = config.select[0];
    const metricType =
      typeof firstSelect !== 'string' ? firstSelect?.metricType : undefined;
    const tableName = getMetricTableName(source, metricType);
    if (!tableName) continue;
    tableConnections.push({
      databaseName: source.from.databaseName,
      tableName: tableName,
      connectionId: source.connection,
    });
  }

  return tableConnections;
}

export function buildMoveTargets(
  containers: DashboardContainerSchema[],
): MoveTarget[] {
  const targets: MoveTarget[] = [];
  for (const container of containers) {
    const tabs = container.tabs ?? [];
    if (tabs.length >= 2) {
      for (const tab of tabs) {
        targets.push({
          containerId: container.id,
          tabId: tab.id,
          label: tab.title,
          allTabs: tabs.map(t => ({ id: t.id, title: t.title })),
        });
      }
    } else if (tabs.length === 1) {
      // 1-tab group: show just the group name, target the single tab
      targets.push({
        containerId: container.id,
        tabId: tabs[0].id,
        label: tabs[0].title,
      });
    } else {
      targets.push({ containerId: container.id, label: container.title });
    }
  }
  return targets;
}

export function getTilesByContainerId({
  containers,
  allTiles,
}: {
  containers: DashboardContainerSchema[];
  allTiles: Tile[];
}): Map<string, Tile[]> {
  const map = new Map<string, Tile[]>();
  for (const container of containers) {
    map.set(
      container.id,
      allTiles.filter(tile => tile.containerId === container.id),
    );
  }
  return map;
}

export function getUngroupedTiles({
  hasContainers,
  allTiles,
  tilesByContainerId,
}: {
  hasContainers: boolean;
  allTiles: Tile[];
  tilesByContainerId: Map<string, Tile[]>;
}): Tile[] {
  return hasContainers
    ? allTiles.filter(
        tile => !tile.containerId || !tilesByContainerId.has(tile.containerId),
      )
    : allTiles;
}

export function getAlertingTabIdsByContainer({
  containers,
  tilesByContainerId,
}: {
  containers: DashboardContainerSchema[];
  tilesByContainerId: Map<string, Tile[]>;
}): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const container of containers) {
    const tiles = tilesByContainerId.get(container.id) ?? [];
    const firstTabId = container.tabs?.[0]?.id;
    const alerting = new Set<string>();
    for (const tile of tiles) {
      if (tile.config.alert?.state === AlertState.ALERT) {
        const attributedTabId = tile.tabId ?? firstTabId;
        if (attributedTabId) alerting.add(attributedTabId);
      }
    }
    if (alerting.size > 0) map.set(container.id, alerting);
  }
  return map;
}
