import { AlertState } from '@hyperdx/common-utils/dist/types';

import { type Tile } from '@/dashboard';

import {
  buildMoveTargets,
  getAlertingTabIdsByContainer,
  getTilesByContainerId,
  getUngroupedTiles,
  hasLayoutChanged,
  tileToLayoutItem,
} from '../utils';

const makeTile = ({
  id,
  containerId,
  tabId,
  isAlerting = false,
}: {
  id: string;
  containerId?: string;
  tabId?: string;
  isAlerting?: boolean;
}): Tile =>
  ({
    id,
    x: 1,
    y: 2,
    w: 3,
    h: 4,
    containerId,
    tabId,
    config: {
      alert: isAlerting ? { state: AlertState.ALERT } : undefined,
    },
  }) as Tile;

describe('DBDashboardPage utils', () => {
  it('converts a tile to a react-grid-layout item', () => {
    expect(tileToLayoutItem(makeTile({ id: 'tile-1' }))).toEqual({
      i: 'tile-1',
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      minH: 1,
      minW: 1,
    });
  });

  it('detects changed layout dimensions and positions', () => {
    const currentLayout = [tileToLayoutItem(makeTile({ id: 'tile-1' }))];

    expect(
      hasLayoutChanged({
        currentLayout,
        newLayout: [{ ...currentLayout[0], x: currentLayout[0].x + 1 }],
      }),
    ).toBe(true);

    expect(
      hasLayoutChanged({
        currentLayout,
        newLayout: currentLayout,
      }),
    ).toBe(false);
  });

  it('builds move targets for plain, single-tab, and multi-tab groups', () => {
    expect(
      buildMoveTargets([
        { id: 'plain', title: 'Plain', collapsed: false },
        {
          id: 'single',
          title: 'Single',
          collapsed: false,
          tabs: [{ id: 'single-tab', title: 'Single Tab' }],
        },
        {
          id: 'multi',
          title: 'Multi',
          collapsed: false,
          tabs: [
            { id: 'tab-a', title: 'Tab A' },
            { id: 'tab-b', title: 'Tab B' },
          ],
        },
      ]),
    ).toEqual([
      { containerId: 'plain', label: 'Plain' },
      {
        containerId: 'single',
        tabId: 'single-tab',
        label: 'Single Tab',
      },
      {
        containerId: 'multi',
        tabId: 'tab-a',
        label: 'Tab A',
        allTabs: [
          { id: 'tab-a', title: 'Tab A' },
          { id: 'tab-b', title: 'Tab B' },
        ],
      },
      {
        containerId: 'multi',
        tabId: 'tab-b',
        label: 'Tab B',
        allTabs: [
          { id: 'tab-a', title: 'Tab A' },
          { id: 'tab-b', title: 'Tab B' },
        ],
      },
    ]);
  });

  it('groups tiles by container and treats orphaned tiles as ungrouped', () => {
    const containers = [{ id: 'group-1', title: 'Group 1', collapsed: false }];
    const allTiles = [
      makeTile({ id: 'grouped', containerId: 'group-1' }),
      makeTile({ id: 'orphaned', containerId: 'deleted-group' }),
      makeTile({ id: 'ungrouped' }),
    ];

    const tilesByContainerId = getTilesByContainerId({
      containers,
      allTiles,
    });

    expect(tilesByContainerId.get('group-1')?.map(tile => tile.id)).toEqual([
      'grouped',
    ]);
    expect(
      getUngroupedTiles({
        hasContainers: true,
        allTiles,
        tilesByContainerId,
      }).map(tile => tile.id),
    ).toEqual(['orphaned', 'ungrouped']);
  });

  it('attributes alerting tiles to their tab or the first tab fallback', () => {
    const containers = [
      {
        id: 'group-1',
        title: 'Group 1',
        collapsed: false,
        tabs: [
          { id: 'tab-a', title: 'Tab A' },
          { id: 'tab-b', title: 'Tab B' },
        ],
      },
    ];
    const tilesByContainerId = getTilesByContainerId({
      containers,
      allTiles: [
        makeTile({ id: 'fallback', containerId: 'group-1', isAlerting: true }),
        makeTile({
          id: 'tabbed',
          containerId: 'group-1',
          tabId: 'tab-b',
          isAlerting: true,
        }),
        makeTile({ id: 'quiet', containerId: 'group-1' }),
      ],
    });

    expect(
      getAlertingTabIdsByContainer({
        containers,
        tilesByContainerId,
      }).get('group-1'),
    ).toEqual(new Set(['tab-a', 'tab-b']));
  });
});
