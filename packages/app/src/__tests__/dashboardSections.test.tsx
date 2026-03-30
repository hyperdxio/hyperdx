import {
  DashboardContainerSchema,
  DashboardSchema,
  TileSchema,
} from '@hyperdx/common-utils/dist/types';

describe('DashboardContainer schema', () => {
  it('validates a valid group', () => {
    const result = DashboardContainerSchema.safeParse({
      id: 'group-1',
      type: 'group',
      title: 'Infrastructure',
      collapsed: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('group');
    }
  });

  it('accepts legacy section type for backward compatibility', () => {
    const result = DashboardContainerSchema.safeParse({
      id: 'section-1',
      type: 'section',
      title: 'Legacy Section',
      collapsed: false,
    });
    expect(result.success).toBe(true);
  });

  it('validates a collapsed group', () => {
    const result = DashboardContainerSchema.safeParse({
      id: 'group-2',
      type: 'group',
      title: 'Database Metrics',
      collapsed: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a container missing required fields', () => {
    const result = DashboardContainerSchema.safeParse({
      id: 'group-3',
      // missing title and collapsed
    });
    expect(result.success).toBe(false);
  });

  it('rejects a container with empty id or title', () => {
    expect(
      DashboardContainerSchema.safeParse({
        id: '',
        type: 'group',
        title: 'Valid',
        collapsed: false,
      }).success,
    ).toBe(false);
    expect(
      DashboardContainerSchema.safeParse({
        id: 'valid',
        type: 'group',
        title: '',
        collapsed: false,
      }).success,
    ).toBe(false);
  });

  it('validates a group container without tabs (legacy plain group)', () => {
    const result = DashboardContainerSchema.safeParse({
      id: 'group-1',
      type: 'group',
      title: 'Key Metrics',
      collapsed: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('group');
      expect(result.data.tabs).toBeUndefined();
    }
  });

  it('validates a group with 1 tab (new default for groups)', () => {
    const result = DashboardContainerSchema.safeParse({
      id: 'group-new',
      type: 'group',
      title: 'New Group',
      collapsed: false,
      tabs: [{ id: 'tab-1', title: 'New Group' }],
      activeTabId: 'tab-1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('group');
      expect(result.data.tabs).toHaveLength(1);
      expect(result.data.tabs![0].title).toBe('New Group');
      expect(result.data.activeTabId).toBe('tab-1');
    }
  });

  it('validates a group with 2+ tabs (tab bar behavior)', () => {
    const result = DashboardContainerSchema.safeParse({
      id: 'group-2',
      type: 'group',
      title: 'Overview Group',
      collapsed: false,
      tabs: [
        { id: 'tab-a', title: 'Tab A' },
        { id: 'tab-b', title: 'Tab B' },
      ],
      activeTabId: 'tab-a',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('group');
      expect(result.data.tabs).toHaveLength(2);
      expect(result.data.activeTabId).toBe('tab-a');
    }
  });

  it('validates a group with 1 tab (plain group, no tab bar)', () => {
    const result = DashboardContainerSchema.safeParse({
      id: 'group-3',
      type: 'group',
      title: 'Single Tab Group',
      collapsed: false,
      tabs: [{ id: 'tab-only', title: 'Only Tab' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('group');
      expect(result.data.tabs).toHaveLength(1);
    }
  });

  it('rejects an invalid container type', () => {
    const result = DashboardContainerSchema.safeParse({
      id: 'c-1',
      type: 'invalid',
      title: 'Bad Type',
      collapsed: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects type tab (no longer valid)', () => {
    const result = DashboardContainerSchema.safeParse({
      id: 'c-2',
      type: 'tab',
      title: 'Old Tab',
      collapsed: false,
    });
    expect(result.success).toBe(false);
  });
});

describe('Tile schema with containerId and tabId', () => {
  const baseTile = {
    id: 'tile-1',
    x: 0,
    y: 0,
    w: 8,
    h: 10,
    config: {
      source: 'source-1',
      select: [
        {
          aggFn: 'count',
          aggCondition: '',
          valueExpression: '',
        },
      ],
      where: '',
      from: { databaseName: 'default', tableName: 'logs' },
    },
  };

  it('validates a tile without containerId (backward compatible)', () => {
    const result = TileSchema.safeParse(baseTile);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.containerId).toBeUndefined();
      expect(result.data.tabId).toBeUndefined();
    }
  });

  it('validates a tile with containerId', () => {
    const result = TileSchema.safeParse({
      ...baseTile,
      containerId: 'section-1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.containerId).toBe('section-1');
    }
  });

  it('validates a tile with containerId and tabId', () => {
    const result = TileSchema.safeParse({
      ...baseTile,
      containerId: 'group-1',
      tabId: 'tab-a',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.containerId).toBe('group-1');
      expect(result.data.tabId).toBe('tab-a');
    }
  });

  it('validates a tile with tabId but no containerId', () => {
    const result = TileSchema.safeParse({
      ...baseTile,
      tabId: 'orphan-tab',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tabId).toBe('orphan-tab');
    }
  });
});

describe('Dashboard schema with containers', () => {
  const baseDashboard = {
    id: 'dash-1',
    name: 'My Dashboard',
    tiles: [],
    tags: ['production'],
  };

  it('validates a dashboard without sections (backward compatible)', () => {
    const result = DashboardSchema.safeParse(baseDashboard);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.containers).toBeUndefined();
    }
  });

  it('validates a dashboard with empty sections array', () => {
    const result = DashboardSchema.safeParse({
      ...baseDashboard,
      containers: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.containers).toEqual([]);
    }
  });

  it('rejects duplicate container IDs', () => {
    const result = DashboardSchema.safeParse({
      ...baseDashboard,
      containers: [
        { id: 's1', type: 'group', title: 'Group A', collapsed: false },
        { id: 's1', type: 'group', title: 'Group B', collapsed: true },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('validates a dashboard with groups', () => {
    const result = DashboardSchema.safeParse({
      ...baseDashboard,
      containers: [
        {
          id: 's1',
          type: 'group',
          title: 'Infrastructure',
          collapsed: false,
        },
        { id: 's2', type: 'group', title: 'Application', collapsed: true },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.containers).toHaveLength(2);
      expect(result.data.containers![0].collapsed).toBe(false);
      expect(result.data.containers![1].collapsed).toBe(true);
    }
  });

  it('accepts legacy section type in dashboard containers', () => {
    const result = DashboardSchema.safeParse({
      ...baseDashboard,
      containers: [
        {
          id: 's1',
          type: 'section',
          title: 'Legacy',
          collapsed: false,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('validates a full dashboard with groups and tiles referencing them', () => {
    const tile = {
      id: 'tile-1',
      x: 0,
      y: 0,
      w: 8,
      h: 10,
      containerId: 's1',
      config: {
        source: 'source-1',
        select: [
          {
            aggFn: 'count',
            aggCondition: '',
            valueExpression: '',
          },
        ],
        where: '',
        from: { databaseName: 'default', tableName: 'logs' },
      },
    };

    const result = DashboardSchema.safeParse({
      ...baseDashboard,
      tiles: [tile],
      containers: [
        {
          id: 's1',
          type: 'group',
          title: 'Infrastructure',
          collapsed: false,
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tiles[0].containerId).toBe('s1');
      expect(result.data.containers![0].title).toBe('Infrastructure');
    }
  });

  it('validates a dashboard with group container with tabs and tiles using tabId', () => {
    const result = DashboardSchema.safeParse({
      ...baseDashboard,
      tiles: [
        {
          id: 'tile-1',
          x: 0,
          y: 0,
          w: 8,
          h: 10,
          containerId: 'g1',
          tabId: 'tab-a',
          config: {
            source: 'source-1',
            select: [
              {
                aggFn: 'count',
                aggCondition: '',
                valueExpression: '',
              },
            ],
            where: '',
            from: { databaseName: 'default', tableName: 'logs' },
          },
        },
      ],
      containers: [
        {
          id: 'g1',
          type: 'group',
          title: 'My Group',
          collapsed: false,
          tabs: [
            { id: 'tab-a', title: 'Tab A' },
            { id: 'tab-b', title: 'Tab B' },
          ],
          activeTabId: 'tab-a',
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tiles[0].tabId).toBe('tab-a');
      expect(result.data.containers![0].tabs).toHaveLength(2);
    }
  });
});

describe('container tile grouping logic', () => {
  // Test the grouping logic used in DBDashboardPage
  type SimpleTile = { id: string; containerId?: string; tabId?: string };
  type SimpleSection = { id: string; title: string; collapsed: boolean };

  function groupTilesBySection(tiles: SimpleTile[], sections: SimpleSection[]) {
    const bySectionId = new Map<string, SimpleTile[]>();
    for (const section of sections) {
      bySectionId.set(
        section.id,
        tiles.filter(t => t.containerId === section.id),
      );
    }
    // Orphaned tiles (containerId not matching any section) fall back to ungrouped
    const ungrouped = tiles.filter(
      t => !t.containerId || !bySectionId.has(t.containerId),
    );
    return { ungrouped, bySectionId };
  }

  it('groups all tiles as ungrouped when no sections exist', () => {
    const tiles: SimpleTile[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const { ungrouped, bySectionId } = groupTilesBySection(tiles, []);
    expect(ungrouped).toHaveLength(3);
    expect(bySectionId.size).toBe(0);
  });

  it('groups tiles by section correctly', () => {
    const tiles: SimpleTile[] = [
      { id: 'a', containerId: 's1' },
      { id: 'b', containerId: 's2' },
      { id: 'c', containerId: 's1' },
      { id: 'd' }, // ungrouped
    ];
    const sections: SimpleSection[] = [
      { id: 's1', title: 'Section 1', collapsed: false },
      { id: 's2', title: 'Section 2', collapsed: true },
    ];
    const { ungrouped, bySectionId } = groupTilesBySection(tiles, sections);
    expect(ungrouped).toHaveLength(1);
    expect(ungrouped[0].id).toBe('d');
    expect(bySectionId.get('s1')).toHaveLength(2);
    expect(bySectionId.get('s2')).toHaveLength(1);
  });

  it('handles sections with no tiles', () => {
    const tiles: SimpleTile[] = [{ id: 'a', containerId: 's1' }];
    const sections: SimpleSection[] = [
      { id: 's1', title: 'Has tiles', collapsed: false },
      { id: 's2', title: 'Empty', collapsed: false },
    ];
    const { bySectionId } = groupTilesBySection(tiles, sections);
    expect(bySectionId.get('s1')).toHaveLength(1);
    expect(bySectionId.get('s2')).toHaveLength(0);
  });

  it('filters visible tiles correctly for lazy loading', () => {
    const tiles: SimpleTile[] = [
      { id: 'a', containerId: 's1' },
      { id: 'b', containerId: 's2' },
      { id: 'c' },
    ];
    const sections: SimpleSection[] = [
      { id: 's1', title: 'Expanded', collapsed: false },
      { id: 's2', title: 'Collapsed', collapsed: true },
    ];

    const collapsedIds = new Set(
      sections.filter(s => s.collapsed).map(s => s.id),
    );
    const visibleTiles = tiles.filter(
      t => !t.containerId || !collapsedIds.has(t.containerId),
    );

    expect(visibleTiles).toHaveLength(2);
    expect(visibleTiles.map(t => t.id)).toEqual(['a', 'c']);
    // Tile 'b' is in collapsed section s2 and should not be rendered
  });

  it('treats tiles with non-existent containerId as ungrouped', () => {
    const tiles: SimpleTile[] = [
      { id: 'a', containerId: 's1' },
      { id: 'b', containerId: 'deleted-section' },
      { id: 'c' },
    ];
    const sections: SimpleSection[] = [
      { id: 's1', title: 'Existing', collapsed: false },
    ];
    const { ungrouped, bySectionId } = groupTilesBySection(tiles, sections);
    // Tile 'b' references a non-existent section, should be ungrouped
    expect(ungrouped).toHaveLength(2);
    expect(ungrouped.map(t => t.id)).toEqual(['b', 'c']);
    expect(bySectionId.get('s1')).toHaveLength(1);
  });

  it('filters group tiles by tabId when group has tabs', () => {
    const tiles: SimpleTile[] = [
      { id: 'a', containerId: 'g1', tabId: 'tab-1' },
      { id: 'b', containerId: 'g1', tabId: 'tab-2' },
      { id: 'c', containerId: 'g1', tabId: 'tab-1' },
    ];
    const sections: SimpleSection[] = [
      { id: 'g1', title: 'Group with Tabs', collapsed: false },
    ];
    const { bySectionId } = groupTilesBySection(tiles, sections);
    const allGroupTiles = bySectionId.get('g1') ?? [];
    expect(allGroupTiles).toHaveLength(3);
    // Filter by tabId (as done in DBDashboardPage)
    const tab1Tiles = allGroupTiles.filter(t => t.tabId === 'tab-1');
    const tab2Tiles = allGroupTiles.filter(t => t.tabId === 'tab-2');
    expect(tab1Tiles).toHaveLength(2);
    expect(tab2Tiles).toHaveLength(1);
  });

  it('group with 0-1 tabs is plain group (no tab filtering)', () => {
    const tiles: SimpleTile[] = [
      { id: 'a', containerId: 'g1' },
      { id: 'b', containerId: 'g1' },
    ];
    const sections: SimpleSection[] = [
      { id: 'g1', title: 'Plain Group', collapsed: false },
    ];
    const { bySectionId } = groupTilesBySection(tiles, sections);
    const groupTiles = bySectionId.get('g1') ?? [];
    // No tab filtering needed for plain groups
    expect(groupTiles).toHaveLength(2);
    expect(groupTiles.every(t => t.tabId === undefined)).toBe(true);
  });

  it('group with 2+ tabs has tab bar behavior (tiles split by tabId)', () => {
    // Simulates the schema: group with tabs array of 2+ entries
    type SimpleGroup = SimpleSection & {
      tabs?: { id: string; title: string }[];
      activeTabId?: string;
    };

    const group: SimpleGroup = {
      id: 'g1',
      title: 'Tabbed Group',
      collapsed: false,
      tabs: [
        { id: 'tab-1', title: 'Tab 1' },
        { id: 'tab-2', title: 'Tab 2' },
      ],
      activeTabId: 'tab-1',
    };

    const tiles: SimpleTile[] = [
      { id: 'a', containerId: 'g1', tabId: 'tab-1' },
      { id: 'b', containerId: 'g1', tabId: 'tab-2' },
      { id: 'c', containerId: 'g1', tabId: 'tab-1' },
    ];

    const hasTabs = (group.tabs?.length ?? 0) >= 2;
    expect(hasTabs).toBe(true);

    // When tabs exist, render prop receives activeTabId and filters tiles
    const activeTabId = group.activeTabId ?? group.tabs![0].id;
    const visibleTiles = tiles.filter(t => t.tabId === activeTabId);
    expect(visibleTiles).toHaveLength(2);
    expect(visibleTiles.map(t => t.id)).toEqual(['a', 'c']);
  });
});

describe('container authoring operations', () => {
  type SimpleTile = { id: string; containerId?: string; tabId?: string };
  type SimpleSection = { id: string; title: string; collapsed: boolean };
  type SimpleDashboard = {
    tiles: SimpleTile[];
    containers?: SimpleSection[];
  };

  function addSection(dashboard: SimpleDashboard, section: SimpleSection) {
    const containers = [...(dashboard.containers ?? []), section];
    return { ...dashboard, containers };
  }

  function renameSection(
    dashboard: SimpleDashboard,
    containerId: string,
    newTitle: string,
  ) {
    const trimmed = newTitle.trim();
    if (!trimmed) return dashboard;
    return {
      ...dashboard,
      containers: dashboard.containers?.map(s =>
        s.id === containerId ? { ...s, title: trimmed } : s,
      ),
    };
  }

  function deleteSection(dashboard: SimpleDashboard, containerId: string) {
    return {
      ...dashboard,
      containers: dashboard.containers?.filter(s => s.id !== containerId),
      tiles: dashboard.tiles.map(t =>
        t.containerId === containerId
          ? { ...t, containerId: undefined, tabId: undefined }
          : t,
      ),
    };
  }

  function toggleSectionCollapsed(
    dashboard: SimpleDashboard,
    containerId: string,
  ) {
    return {
      ...dashboard,
      containers: dashboard.containers?.map(s =>
        s.id === containerId ? { ...s, collapsed: !s.collapsed } : s,
      ),
    };
  }

  function moveTileToSection(
    dashboard: SimpleDashboard,
    tileId: string,
    containerId: string | undefined,
    tabId?: string,
  ) {
    return {
      ...dashboard,
      tiles: dashboard.tiles.map(t =>
        t.id === tileId ? { ...t, containerId, tabId } : t,
      ),
    };
  }

  describe('add section', () => {
    it('adds a section to a dashboard without sections', () => {
      const dashboard: SimpleDashboard = { tiles: [] };
      const result = addSection(dashboard, {
        id: 's1',
        title: 'New Section',
        collapsed: false,
      });
      expect(result.containers).toHaveLength(1);
      expect(result.containers![0]).toEqual({
        id: 's1',
        title: 'New Section',
        collapsed: false,
      });
    });

    it('appends to existing sections', () => {
      const dashboard: SimpleDashboard = {
        tiles: [],
        containers: [{ id: 's1', title: 'First', collapsed: false }],
      };
      const result = addSection(dashboard, {
        id: 's2',
        title: 'Second',
        collapsed: false,
      });
      expect(result.containers).toHaveLength(2);
      expect(result.containers![1].id).toBe('s2');
    });
  });

  describe('rename section', () => {
    it('renames a section', () => {
      const dashboard: SimpleDashboard = {
        tiles: [],
        containers: [{ id: 's1', title: 'Old Name', collapsed: false }],
      };
      const result = renameSection(dashboard, 's1', 'New Name');
      expect(result.containers![0].title).toBe('New Name');
    });

    it('trims whitespace from new title', () => {
      const dashboard: SimpleDashboard = {
        tiles: [],
        containers: [{ id: 's1', title: 'Old', collapsed: false }],
      };
      const result = renameSection(dashboard, 's1', '  Trimmed  ');
      expect(result.containers![0].title).toBe('Trimmed');
    });

    it('rejects empty title', () => {
      const dashboard: SimpleDashboard = {
        tiles: [],
        containers: [{ id: 's1', title: 'Keep Me', collapsed: false }],
      };
      const result = renameSection(dashboard, 's1', '   ');
      expect(result.containers![0].title).toBe('Keep Me');
    });

    it('does not affect other sections', () => {
      const dashboard: SimpleDashboard = {
        tiles: [],
        containers: [
          { id: 's1', title: 'One', collapsed: false },
          { id: 's2', title: 'Two', collapsed: true },
        ],
      };
      const result = renameSection(dashboard, 's1', 'Updated');
      expect(result.containers![0].title).toBe('Updated');
      expect(result.containers![1].title).toBe('Two');
    });
  });

  describe('delete section', () => {
    it('removes the section', () => {
      const dashboard: SimpleDashboard = {
        tiles: [],
        containers: [
          { id: 's1', title: 'Keep', collapsed: false },
          { id: 's2', title: 'Delete Me', collapsed: false },
        ],
      };
      const result = deleteSection(dashboard, 's2');
      expect(result.containers).toHaveLength(1);
      expect(result.containers![0].id).toBe('s1');
    });

    it('ungroups child tiles when section is deleted', () => {
      const dashboard: SimpleDashboard = {
        tiles: [
          { id: 'a', containerId: 's1' },
          { id: 'b', containerId: 's1' },
          { id: 'c', containerId: 's2' },
          { id: 'd' },
        ],
        containers: [
          { id: 's1', title: 'Delete Me', collapsed: false },
          { id: 's2', title: 'Keep', collapsed: false },
        ],
      };
      const result = deleteSection(dashboard, 's1');
      expect(result.containers).toHaveLength(1);
      expect(result.tiles.find(t => t.id === 'a')?.containerId).toBeUndefined();
      expect(result.tiles.find(t => t.id === 'b')?.containerId).toBeUndefined();
      expect(result.tiles.find(t => t.id === 'c')?.containerId).toBe('s2');
      expect(result.tiles.find(t => t.id === 'd')?.containerId).toBeUndefined();
    });

    it('clears tabId when deleting a group with tabs', () => {
      const dashboard: SimpleDashboard = {
        tiles: [
          { id: 'a', containerId: 'g1', tabId: 'tab-1' },
          { id: 'b', containerId: 'g1', tabId: 'tab-2' },
          { id: 'c', containerId: 's1' },
        ],
        containers: [
          { id: 'g1', title: 'Group with Tabs', collapsed: false },
          { id: 's1', title: 'Section', collapsed: false },
        ],
      };
      const result = deleteSection(dashboard, 'g1');
      expect(result.tiles.find(t => t.id === 'a')?.containerId).toBeUndefined();
      expect(result.tiles.find(t => t.id === 'a')?.tabId).toBeUndefined();
      expect(result.tiles.find(t => t.id === 'b')?.tabId).toBeUndefined();
      expect(result.tiles.find(t => t.id === 'c')?.containerId).toBe('s1');
    });

    it('handles deleting the last section', () => {
      const dashboard: SimpleDashboard = {
        tiles: [{ id: 'a', containerId: 's1' }],
        containers: [{ id: 's1', title: 'Only One', collapsed: false }],
      };
      const result = deleteSection(dashboard, 's1');
      expect(result.containers).toHaveLength(0);
      expect(result.tiles[0].containerId).toBeUndefined();
    });
  });

  describe('toggle default collapsed', () => {
    it('toggles collapsed from false to true', () => {
      const dashboard: SimpleDashboard = {
        tiles: [],
        containers: [{ id: 's1', title: 'Test', collapsed: false }],
      };
      const result = toggleSectionCollapsed(dashboard, 's1');
      expect(result.containers![0].collapsed).toBe(true);
    });

    it('toggles collapsed from true to false', () => {
      const dashboard: SimpleDashboard = {
        tiles: [],
        containers: [{ id: 's1', title: 'Test', collapsed: true }],
      };
      const result = toggleSectionCollapsed(dashboard, 's1');
      expect(result.containers![0].collapsed).toBe(false);
    });
  });

  describe('move tile to section', () => {
    it('assigns a tile to a section', () => {
      const dashboard: SimpleDashboard = {
        tiles: [{ id: 'a' }, { id: 'b' }],
        containers: [{ id: 's1', title: 'Target', collapsed: false }],
      };
      const result = moveTileToSection(dashboard, 'a', 's1');
      expect(result.tiles.find(t => t.id === 'a')?.containerId).toBe('s1');
      expect(result.tiles.find(t => t.id === 'b')?.containerId).toBeUndefined();
    });

    it('moves a tile between sections', () => {
      const dashboard: SimpleDashboard = {
        tiles: [{ id: 'a', containerId: 's1' }],
        containers: [
          { id: 's1', title: 'From', collapsed: false },
          { id: 's2', title: 'To', collapsed: false },
        ],
      };
      const result = moveTileToSection(dashboard, 'a', 's2');
      expect(result.tiles[0].containerId).toBe('s2');
    });

    it('ungroups a tile from a section', () => {
      const dashboard: SimpleDashboard = {
        tiles: [{ id: 'a', containerId: 's1' }],
        containers: [{ id: 's1', title: 'Source', collapsed: false }],
      };
      const result = moveTileToSection(dashboard, 'a', undefined);
      expect(result.tiles[0].containerId).toBeUndefined();
    });

    it('moves a tile to a specific tab in a group', () => {
      const dashboard: SimpleDashboard = {
        tiles: [{ id: 'a' }],
        containers: [{ id: 'g1', title: 'Group with Tabs', collapsed: false }],
      };
      const result = moveTileToSection(dashboard, 'a', 'g1', 'tab-1');
      expect(result.tiles[0].containerId).toBe('g1');
      expect(result.tiles[0].tabId).toBe('tab-1');
    });

    it('clears tabId when moving from group tab to regular section', () => {
      const dashboard: SimpleDashboard = {
        tiles: [{ id: 'a', containerId: 'g1', tabId: 'tab-1' }],
        containers: [
          { id: 'g1', title: 'Group with Tabs', collapsed: false },
          { id: 's1', title: 'Section', collapsed: false },
        ],
      };
      const result = moveTileToSection(dashboard, 'a', 's1');
      expect(result.tiles[0].containerId).toBe('s1');
      expect(result.tiles[0].tabId).toBeUndefined();
    });
  });

  describe('reorder sections', () => {
    function reorderSections(
      dashboard: SimpleDashboard,
      fromIndex: number,
      toIndex: number,
    ) {
      if (!dashboard.containers) return dashboard;
      const containers = [...dashboard.containers];
      const [removed] = containers.splice(fromIndex, 1);
      containers.splice(toIndex, 0, removed);
      return { ...dashboard, containers };
    }

    it('moves a section from first to last', () => {
      const dashboard: SimpleDashboard = {
        tiles: [],
        containers: [
          { id: 's1', title: 'First', collapsed: false },
          { id: 's2', title: 'Second', collapsed: false },
          { id: 's3', title: 'Third', collapsed: false },
        ],
      };
      const result = reorderSections(dashboard, 0, 2);
      expect(result.containers!.map(c => c.id)).toEqual(['s2', 's3', 's1']);
    });

    it('moves a section from last to first', () => {
      const dashboard: SimpleDashboard = {
        tiles: [],
        containers: [
          { id: 's1', title: 'First', collapsed: false },
          { id: 's2', title: 'Second', collapsed: false },
          { id: 's3', title: 'Third', collapsed: false },
        ],
      };
      const result = reorderSections(dashboard, 2, 0);
      expect(result.containers!.map(c => c.id)).toEqual(['s3', 's1', 's2']);
    });

    it('does not affect tiles when sections are reordered', () => {
      const dashboard: SimpleDashboard = {
        tiles: [
          { id: 'a', containerId: 's1' },
          { id: 'b', containerId: 's2' },
        ],
        containers: [
          { id: 's1', title: 'First', collapsed: false },
          { id: 's2', title: 'Second', collapsed: false },
        ],
      };
      const result = reorderSections(dashboard, 0, 1);
      expect(result.tiles).toEqual(dashboard.tiles);
      expect(result.containers!.map(c => c.id)).toEqual(['s2', 's1']);
    });
  });

  describe('group selected tiles', () => {
    function groupTilesIntoSection(
      dashboard: SimpleDashboard,
      tileIds: string[],
      newSection: SimpleSection,
    ) {
      const containers = [...(dashboard.containers ?? []), newSection];
      const tiles = dashboard.tiles.map(t =>
        tileIds.includes(t.id) ? { ...t, containerId: newSection.id } : t,
      );
      return { ...dashboard, containers, tiles };
    }

    it('groups selected tiles into a new section', () => {
      const dashboard: SimpleDashboard = {
        tiles: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      };
      const result = groupTilesIntoSection(dashboard, ['a', 'c'], {
        id: 'new-s',
        title: 'New Section',
        collapsed: false,
      });
      expect(result.containers).toHaveLength(1);
      expect(result.tiles.find(t => t.id === 'a')?.containerId).toBe('new-s');
      expect(result.tiles.find(t => t.id === 'b')?.containerId).toBeUndefined();
      expect(result.tiles.find(t => t.id === 'c')?.containerId).toBe('new-s');
    });

    it('preserves existing sections when grouping', () => {
      const dashboard: SimpleDashboard = {
        tiles: [{ id: 'a', containerId: 's1' }, { id: 'b' }, { id: 'c' }],
        containers: [{ id: 's1', title: 'Existing', collapsed: false }],
      };
      const result = groupTilesIntoSection(dashboard, ['b', 'c'], {
        id: 'new-s',
        title: 'Grouped',
        collapsed: false,
      });
      expect(result.containers).toHaveLength(2);
      expect(result.tiles.find(t => t.id === 'a')?.containerId).toBe('s1');
      expect(result.tiles.find(t => t.id === 'b')?.containerId).toBe('new-s');
      expect(result.tiles.find(t => t.id === 'c')?.containerId).toBe('new-s');
    });
  });
});

describe('group tab operations', () => {
  type SimpleTab = { id: string; title: string };
  type SimpleGroup = {
    id: string;
    title: string;
    type: 'group';
    collapsed: boolean;
    tabs?: SimpleTab[];
    activeTabId?: string;
  };
  type SimpleTile = { id: string; containerId?: string; tabId?: string };

  it('group creation always has 1 tab', () => {
    // Simulates handleAddContainer('group')
    const tabId = 'tab-new';
    const group: SimpleGroup = {
      id: 'g1',
      type: 'group',
      title: 'New Group',
      collapsed: false,
      tabs: [{ id: tabId, title: 'New Group' }],
      activeTabId: tabId,
    };

    expect(group.tabs).toHaveLength(1);
    expect(group.tabs![0].title).toBe('New Group');
    expect(group.activeTabId).toBe(tabId);
  });

  it('adding tab to 1-tab group creates second tab without renaming first', () => {
    // Simulates handleAddTab for a group with 1 tab
    const group: SimpleGroup = {
      id: 'g1',
      type: 'group',
      title: 'My Group',
      collapsed: false,
      tabs: [{ id: 'tab-1', title: 'My Group' }],
      activeTabId: 'tab-1',
    };
    const tiles: SimpleTile[] = [{ id: 'a', containerId: 'g1' }];

    // Add second tab (simulates the hook logic)
    const newTabId = 'tab-2';
    const updatedTabs = [...group.tabs!, { id: newTabId, title: 'New Tab' }];
    const updatedTiles = tiles.map(t =>
      t.containerId === 'g1' && !t.tabId ? { ...t, tabId: 'tab-1' } : t,
    );

    expect(updatedTabs).toHaveLength(2);
    expect(updatedTabs[0].title).toBe('My Group'); // First tab NOT renamed
    expect(updatedTabs[1].title).toBe('New Tab');
    expect(updatedTiles[0].tabId).toBe('tab-1');
  });

  it('group title syncs from tabs[0].title for 1-tab groups', () => {
    // Simulates handleRenameSection for a group with 1 tab
    const group: SimpleGroup = {
      id: 'g1',
      type: 'group',
      title: 'Old Name',
      collapsed: false,
      tabs: [{ id: 'tab-1', title: 'Old Name' }],
      activeTabId: 'tab-1',
    };

    // Rename via header (which syncs to tabs[0])
    const newTitle = 'New Name';
    const updatedGroup = {
      ...group,
      title: newTitle,
      tabs: group.tabs!.map((t, i) =>
        i === 0 ? { ...t, title: newTitle } : t,
      ),
    };

    expect(updatedGroup.title).toBe('New Name');
    expect(updatedGroup.tabs![0].title).toBe('New Name');
  });

  it('removing to 1 tab keeps the tab in the array', () => {
    // Simulates handleDeleteTab leaving 1 tab
    const group: SimpleGroup = {
      id: 'g1',
      type: 'group',
      title: 'My Group',
      collapsed: false,
      tabs: [
        { id: 'tab-1', title: 'Tab A' },
        { id: 'tab-2', title: 'Tab B' },
      ],
      activeTabId: 'tab-1',
    };
    const tiles: SimpleTile[] = [
      { id: 'a', containerId: 'g1', tabId: 'tab-1' },
      { id: 'b', containerId: 'g1', tabId: 'tab-2' },
    ];

    // Delete tab-2, keep tab-1
    const deletedTabId = 'tab-2';
    const remaining = group.tabs!.filter(t => t.id !== deletedTabId);
    const keepTab = remaining[0];

    // Move tiles from deleted tab to remaining tab
    const updatedTiles = tiles.map(t =>
      t.containerId === 'g1' && t.tabId === deletedTabId
        ? { ...t, tabId: keepTab.id }
        : t,
    );

    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('tab-1');
    // All tiles should now reference the remaining tab
    expect(updatedTiles.every(t => t.tabId === 'tab-1')).toBe(true);
    // Tab bar hidden because only 1 tab remains (rendering handles this)
    expect(remaining.length >= 2).toBe(false);
  });
});
