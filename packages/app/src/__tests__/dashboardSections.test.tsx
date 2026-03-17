import {
  DashboardSchema,
  DashboardSectionSchema,
  TileSchema,
} from '@hyperdx/common-utils/dist/types';

describe('DashboardSection schema', () => {
  it('validates a valid section', () => {
    const result = DashboardSectionSchema.safeParse({
      id: 'section-1',
      title: 'Infrastructure',
      collapsed: false,
    });
    expect(result.success).toBe(true);
  });

  it('validates a collapsed section', () => {
    const result = DashboardSectionSchema.safeParse({
      id: 'section-2',
      title: 'Database Metrics',
      collapsed: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a section missing required fields', () => {
    const result = DashboardSectionSchema.safeParse({
      id: 'section-3',
      // missing title and collapsed
    });
    expect(result.success).toBe(false);
  });

  it('rejects a section with empty id or title', () => {
    expect(
      DashboardSectionSchema.safeParse({
        id: '',
        title: 'Valid',
        collapsed: false,
      }).success,
    ).toBe(false);
    expect(
      DashboardSectionSchema.safeParse({
        id: 'valid',
        title: '',
        collapsed: false,
      }).success,
    ).toBe(false);
  });
});

describe('Tile schema with sectionId', () => {
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

  it('validates a tile without sectionId (backward compatible)', () => {
    const result = TileSchema.safeParse(baseTile);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sectionId).toBeUndefined();
    }
  });

  it('validates a tile with sectionId', () => {
    const result = TileSchema.safeParse({
      ...baseTile,
      sectionId: 'section-1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sectionId).toBe('section-1');
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
      expect(result.data.sections).toBeUndefined();
    }
  });

  it('validates a dashboard with empty sections array', () => {
    const result = DashboardSchema.safeParse({
      ...baseDashboard,
      sections: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sections).toEqual([]);
    }
  });

  it('rejects duplicate section IDs', () => {
    const result = DashboardSchema.safeParse({
      ...baseDashboard,
      sections: [
        { id: 's1', title: 'Section A', collapsed: false },
        { id: 's1', title: 'Section B', collapsed: true },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('validates a dashboard with sections', () => {
    const result = DashboardSchema.safeParse({
      ...baseDashboard,
      sections: [
        { id: 's1', title: 'Infrastructure', collapsed: false },
        { id: 's2', title: 'Application', collapsed: true },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sections).toHaveLength(2);
      expect(result.data.sections![0].collapsed).toBe(false);
      expect(result.data.sections![1].collapsed).toBe(true);
    }
  });

  it('validates a full dashboard with sections and tiles referencing them', () => {
    const tile = {
      id: 'tile-1',
      x: 0,
      y: 0,
      w: 8,
      h: 10,
      sectionId: 's1',
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
      sections: [{ id: 's1', title: 'Infrastructure', collapsed: false }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tiles[0].sectionId).toBe('s1');
      expect(result.data.sections![0].title).toBe('Infrastructure');
    }
  });
});

describe('section tile grouping logic', () => {
  // Test the grouping logic used in DBDashboardPage
  type SimpleTile = { id: string; sectionId?: string };
  type SimpleSection = { id: string; title: string; collapsed: boolean };

  function groupTilesBySection(tiles: SimpleTile[], sections: SimpleSection[]) {
    const bySectionId = new Map<string, SimpleTile[]>();
    for (const section of sections) {
      bySectionId.set(
        section.id,
        tiles.filter(t => t.sectionId === section.id),
      );
    }
    // Orphaned tiles (sectionId not matching any section) fall back to ungrouped
    const ungrouped = tiles.filter(
      t => !t.sectionId || !bySectionId.has(t.sectionId),
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
      { id: 'a', sectionId: 's1' },
      { id: 'b', sectionId: 's2' },
      { id: 'c', sectionId: 's1' },
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
    const tiles: SimpleTile[] = [{ id: 'a', sectionId: 's1' }];
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
      { id: 'a', sectionId: 's1' },
      { id: 'b', sectionId: 's2' },
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
      t => !t.sectionId || !collapsedIds.has(t.sectionId),
    );

    expect(visibleTiles).toHaveLength(2);
    expect(visibleTiles.map(t => t.id)).toEqual(['a', 'c']);
    // Tile 'b' is in collapsed section s2 and should not be rendered
  });

  it('treats tiles with non-existent sectionId as ungrouped', () => {
    const tiles: SimpleTile[] = [
      { id: 'a', sectionId: 's1' },
      { id: 'b', sectionId: 'deleted-section' },
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
  type SimpleTile = { id: string; sectionId?: string };
  type SimpleSection = { id: string; title: string; collapsed: boolean };
  type SimpleDashboard = {
    tiles: SimpleTile[];
    sections?: SimpleSection[];
  };

  function addSection(dashboard: SimpleDashboard, section: SimpleSection) {
    const sections = [...(dashboard.sections ?? []), section];
    return { ...dashboard, sections };
  }

  function renameSection(
    dashboard: SimpleDashboard,
    sectionId: string,
    newTitle: string,
  ) {
    const trimmed = newTitle.trim();
    if (!trimmed) return dashboard;
    return {
      ...dashboard,
      sections: dashboard.sections?.map(s =>
        s.id === sectionId ? { ...s, title: trimmed } : s,
      ),
    };
  }

  function deleteSection(dashboard: SimpleDashboard, sectionId: string) {
    return {
      ...dashboard,
      sections: dashboard.sections?.filter(s => s.id !== sectionId),
      tiles: dashboard.tiles.map(t =>
        t.sectionId === sectionId ? { ...t, sectionId: undefined } : t,
      ),
    };
  }

  function toggleSectionCollapsed(
    dashboard: SimpleDashboard,
    sectionId: string,
  ) {
    return {
      ...dashboard,
      sections: dashboard.sections?.map(s =>
        s.id === sectionId ? { ...s, collapsed: !s.collapsed } : s,
      ),
    };
  }

  function moveTileToSection(
    dashboard: SimpleDashboard,
    tileId: string,
    sectionId: string | undefined,
  ) {
    return {
      ...dashboard,
      tiles: dashboard.tiles.map(t =>
        t.id === tileId ? { ...t, sectionId } : t,
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
      expect(result.sections).toHaveLength(1);
      expect(result.sections![0]).toEqual({
        id: 's1',
        title: 'New Section',
        collapsed: false,
      });
    });

    it('appends to existing sections', () => {
      const dashboard: SimpleDashboard = {
        tiles: [],
        sections: [{ id: 's1', title: 'First', collapsed: false }],
      };
      const result = addSection(dashboard, {
        id: 's2',
        title: 'Second',
        collapsed: false,
      });
      expect(result.sections).toHaveLength(2);
      expect(result.sections![1].id).toBe('s2');
    });
  });

  describe('rename section', () => {
    it('renames a section', () => {
      const dashboard: SimpleDashboard = {
        tiles: [],
        sections: [{ id: 's1', title: 'Old Name', collapsed: false }],
      };
      const result = renameSection(dashboard, 's1', 'New Name');
      expect(result.sections![0].title).toBe('New Name');
    });

    it('trims whitespace from new title', () => {
      const dashboard: SimpleDashboard = {
        tiles: [],
        sections: [{ id: 's1', title: 'Old', collapsed: false }],
      };
      const result = renameSection(dashboard, 's1', '  Trimmed  ');
      expect(result.sections![0].title).toBe('Trimmed');
    });

    it('rejects empty title', () => {
      const dashboard: SimpleDashboard = {
        tiles: [],
        sections: [{ id: 's1', title: 'Keep Me', collapsed: false }],
      };
      const result = renameSection(dashboard, 's1', '   ');
      expect(result.sections![0].title).toBe('Keep Me');
    });

    it('does not affect other sections', () => {
      const dashboard: SimpleDashboard = {
        tiles: [],
        sections: [
          { id: 's1', title: 'One', collapsed: false },
          { id: 's2', title: 'Two', collapsed: true },
        ],
      };
      const result = renameSection(dashboard, 's1', 'Updated');
      expect(result.sections![0].title).toBe('Updated');
      expect(result.sections![1].title).toBe('Two');
    });
  });

  describe('delete section', () => {
    it('removes the section', () => {
      const dashboard: SimpleDashboard = {
        tiles: [],
        sections: [
          { id: 's1', title: 'Keep', collapsed: false },
          { id: 's2', title: 'Delete Me', collapsed: false },
        ],
      };
      const result = deleteSection(dashboard, 's2');
      expect(result.sections).toHaveLength(1);
      expect(result.sections![0].id).toBe('s1');
    });

    it('ungroups child tiles when section is deleted', () => {
      const dashboard: SimpleDashboard = {
        tiles: [
          { id: 'a', sectionId: 's1' },
          { id: 'b', sectionId: 's1' },
          { id: 'c', sectionId: 's2' },
          { id: 'd' },
        ],
        sections: [
          { id: 's1', title: 'Delete Me', collapsed: false },
          { id: 's2', title: 'Keep', collapsed: false },
        ],
      };
      const result = deleteSection(dashboard, 's1');
      expect(result.sections).toHaveLength(1);
      expect(result.tiles.find(t => t.id === 'a')?.sectionId).toBeUndefined();
      expect(result.tiles.find(t => t.id === 'b')?.sectionId).toBeUndefined();
      expect(result.tiles.find(t => t.id === 'c')?.sectionId).toBe('s2');
      expect(result.tiles.find(t => t.id === 'd')?.sectionId).toBeUndefined();
    });

    it('handles deleting the last section', () => {
      const dashboard: SimpleDashboard = {
        tiles: [{ id: 'a', sectionId: 's1' }],
        sections: [{ id: 's1', title: 'Only One', collapsed: false }],
      };
      const result = deleteSection(dashboard, 's1');
      expect(result.sections).toHaveLength(0);
      expect(result.tiles[0].sectionId).toBeUndefined();
    });
  });

  describe('toggle default collapsed', () => {
    it('toggles collapsed from false to true', () => {
      const dashboard: SimpleDashboard = {
        tiles: [],
        sections: [{ id: 's1', title: 'Test', collapsed: false }],
      };
      const result = toggleSectionCollapsed(dashboard, 's1');
      expect(result.sections![0].collapsed).toBe(true);
    });

    it('toggles collapsed from true to false', () => {
      const dashboard: SimpleDashboard = {
        tiles: [],
        sections: [{ id: 's1', title: 'Test', collapsed: true }],
      };
      const result = toggleSectionCollapsed(dashboard, 's1');
      expect(result.sections![0].collapsed).toBe(false);
    });
  });

  describe('move tile to section', () => {
    it('assigns a tile to a section', () => {
      const dashboard: SimpleDashboard = {
        tiles: [{ id: 'a' }, { id: 'b' }],
        sections: [{ id: 's1', title: 'Target', collapsed: false }],
      };
      const result = moveTileToSection(dashboard, 'a', 's1');
      expect(result.tiles.find(t => t.id === 'a')?.sectionId).toBe('s1');
      expect(result.tiles.find(t => t.id === 'b')?.sectionId).toBeUndefined();
    });

    it('moves a tile between sections', () => {
      const dashboard: SimpleDashboard = {
        tiles: [{ id: 'a', sectionId: 's1' }],
        sections: [
          { id: 's1', title: 'From', collapsed: false },
          { id: 's2', title: 'To', collapsed: false },
        ],
      };
      const result = moveTileToSection(dashboard, 'a', 's2');
      expect(result.tiles[0].sectionId).toBe('s2');
    });

    it('ungroups a tile from a section', () => {
      const dashboard: SimpleDashboard = {
        tiles: [{ id: 'a', sectionId: 's1' }],
        sections: [{ id: 's1', title: 'Source', collapsed: false }],
      };
      const result = moveTileToSection(dashboard, 'a', undefined);
      expect(result.tiles[0].sectionId).toBeUndefined();
    });
  });
});
