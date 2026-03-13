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
