import { AlertState } from '@hyperdx/common-utils/dist/types';

import { type Dashboard, type Tile } from '@/dashboard';

import {
  buildMoveTargets,
  downloadObjectAsJson,
  getAlertingTabIdsByContainer,
  getDashboardTableConnections,
  getTilesByContainerId,
  getUngroupedTiles,
  hasLayoutChanged,
  tileToLayoutItem,
  updateLayout,
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

  it('updateLayout mutates tile coordinates by id', () => {
    const dashboard = {
      id: 'dash-1',
      name: 'Test',
      tiles: [
        { ...makeTile({ id: 'tile-1' }) },
        { ...makeTile({ id: 'tile-2' }) },
      ],
      tags: [],
    } as Dashboard;

    updateLayout([
      { i: 'tile-1', x: 10, y: 20, w: 5, h: 6 },
      { i: 'tile-missing', x: 99, y: 99, w: 99, h: 99 },
    ])(dashboard);

    expect(dashboard.tiles[0]).toMatchObject({
      id: 'tile-1',
      x: 10,
      y: 20,
      w: 5,
      h: 6,
    });
    // Untouched tile keeps its original coords
    expect(dashboard.tiles[1]).toMatchObject({
      id: 'tile-2',
      x: 1,
      y: 2,
      w: 3,
      h: 4,
    });
  });

  it('downloadObjectAsJson triggers a download via a temporary anchor', () => {
    const click = jest.fn();
    const remove = jest.fn();
    const setAttribute = jest.fn();
    const fakeAnchor = { setAttribute, click, remove } as unknown as Element;

    const createElementSpy = jest
      .spyOn(document, 'createElement')
      .mockReturnValue(fakeAnchor as HTMLAnchorElement);
    const appendChildSpy = jest
      .spyOn(document.body, 'appendChild')
      .mockReturnValue(fakeAnchor as Node);

    downloadObjectAsJson({ hello: 'world' }, 'my-file');

    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(setAttribute).toHaveBeenCalledWith(
      'href',
      `data:text/json;charset=utf-8,${encodeURIComponent(
        JSON.stringify({ hello: 'world' }),
      )}`,
    );
    expect(setAttribute).toHaveBeenCalledWith('download', 'my-file.json');
    expect(appendChildSpy).toHaveBeenCalledWith(fakeAnchor);
    expect(click).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);

    createElementSpy.mockRestore();
    appendChildSpy.mockRestore();
  });

  describe('getDashboardTableConnections', () => {
    it('returns [] when dashboard is undefined', () => {
      expect(
        getDashboardTableConnections({
          dashboard: undefined,
          sources: [],
        }),
      ).toEqual([]);
    });

    it('skips tiles that are not builder configs', () => {
      const dashboard = {
        id: 'dash',
        name: 'd',
        tags: [],
        tiles: [
          {
            ...makeTile({ id: 'raw' }),
            config: { configType: 'sql', source: 'src-1' } as any,
          },
        ],
      } as Dashboard;
      expect(getDashboardTableConnections({ dashboard, sources: [] })).toEqual(
        [],
      );
    });

    it('skips tiles whose source cannot be resolved', () => {
      const dashboard = {
        id: 'dash',
        name: 'd',
        tags: [],
        tiles: [
          {
            ...makeTile({ id: 'b' }),
            config: { source: 'unknown', select: [] } as any,
          },
        ],
      } as Dashboard;
      expect(
        getDashboardTableConnections({
          dashboard,
          sources: [{ id: 'src-1' } as any],
        }),
      ).toEqual([]);
    });

    it('skips tiles whose tableName cannot be resolved', () => {
      const dashboard = {
        id: 'dash',
        name: 'd',
        tags: [],
        tiles: [
          {
            ...makeTile({ id: 'b' }),
            config: { source: 'src-1', select: [] } as any,
          },
        ],
      } as Dashboard;
      // Source exists but has no `from.tableName`, so getMetricTableName falls
      // back to source.from?.tableName which is undefined → skip.
      expect(
        getDashboardTableConnections({
          dashboard,
          sources: [
            {
              id: 'src-1',
              kind: 'log',
              from: { databaseName: 'default' },
              connection: 'conn-1',
            } as any,
          ],
        }),
      ).toEqual([]);
    });

    it('returns a TableConnection for each builder tile with a resolvable source/table', () => {
      const dashboard = {
        id: 'dash',
        name: 'd',
        tags: [],
        tiles: [
          {
            ...makeTile({ id: 'b' }),
            config: { source: 'src-1', select: [] } as any,
          },
        ],
      } as Dashboard;
      expect(
        getDashboardTableConnections({
          dashboard,
          sources: [
            {
              id: 'src-1',
              kind: 'log',
              from: { databaseName: 'default', tableName: 'logs' },
              connection: 'conn-1',
            } as any,
          ],
        }),
      ).toEqual([
        {
          databaseName: 'default',
          tableName: 'logs',
          connectionId: 'conn-1',
        },
      ]);
    });
  });
});
