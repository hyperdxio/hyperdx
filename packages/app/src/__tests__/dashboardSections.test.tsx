import {
  DashboardContainerSchema,
  DashboardSchema,
  TileSchema,
} from '@hyperdx/common-utils/dist/types';

describe('DashboardContainer schema', () => {
  it('validates a valid section', () => {
    const result = DashboardContainerSchema.safeParse({
      id: 'section-1',
      title: 'Infrastructure',
      collapsed: false,
    });
    expect(result.success).toBe(true);
  });

  it('validates a collapsed section', () => {
    const result = DashboardContainerSchema.safeParse({
      id: 'section-2',
      title: 'Database Metrics',
      collapsed: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a section missing required fields', () => {
    const result = DashboardContainerSchema.safeParse({
      id: 'section-3',
      // missing title and collapsed
    });
    expect(result.success).toBe(false);
  });

  it('rejects a section with empty id or title', () => {
    expect(
      DashboardContainerSchema.safeParse({
        id: '',
        title: 'Valid',
        collapsed: false,
      }).success,
    ).toBe(false);
    expect(
      DashboardContainerSchema.safeParse({
        id: 'valid',
        title: '',
        collapsed: false,
      }).success,
    ).toBe(false);
  });
});

describe('Tile schema with containerId', () => {
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
});

describe('Dashboard schema with sections', () => {
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

  it('rejects duplicate section IDs', () => {
    const result = DashboardSchema.safeParse({
      ...baseDashboard,
      containers: [
        { id: 's1', title: 'Section A', collapsed: false },
        { id: 's1', title: 'Section B', collapsed: true },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('validates a dashboard with sections', () => {
    const result = DashboardSchema.safeParse({
      ...baseDashboard,
      containers: [
        { id: 's1', title: 'Infrastructure', collapsed: false },
        { id: 's2', title: 'Application', collapsed: true },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.containers).toHaveLength(2);
      expect(result.data.containers![0].collapsed).toBe(false);
      expect(result.data.containers![1].collapsed).toBe(true);
    }
  });

  it('validates a full dashboard with sections and tiles referencing them', () => {
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
      containers: [{ id: 's1', title: 'Infrastructure', collapsed: false }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tiles[0].containerId).toBe('s1');
      expect(result.data.containers![0].title).toBe('Infrastructure');
    }
  });
});

describe('section tile grouping logic', () => {
  // Test the grouping logic used in DBDashboardPage
  type SimpleTile = { id: string; containerId?: string };
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
});

describe('section authoring operations', () => {
  type SimpleTile = { id: string; containerId?: string };
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
        t.containerId === containerId ? { ...t, containerId: undefined } : t,
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
  ) {
    return {
      ...dashboard,
      tiles: dashboard.tiles.map(t =>
        t.id === tileId ? { ...t, containerId } : t,
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
  });
});
