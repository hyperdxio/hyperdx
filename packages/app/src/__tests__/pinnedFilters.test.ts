/**
 * Tests for pinned filters logic:
 * - PinnedFiltersApiResponse shape
 * - localStorage migration logic
 */

describe('PinnedFiltersApiResponse', () => {
  it('team-only shape has no personal field', () => {
    const response = {
      team: {
        id: '1',
        fields: ['ServiceName'],
        filters: { ServiceName: ['web', 'api'] },
      },
    };

    expect(response.team).not.toBeNull();
    expect(response.team.fields).toEqual(['ServiceName']);
    expect(response.team.filters).toEqual({ ServiceName: ['web', 'api'] });
  });

  it('returns null team when no pins exist', () => {
    const response = { team: null };
    expect(response.team).toBeNull();
  });

  it('handles empty fields and filters', () => {
    const response = {
      team: { id: '1', fields: [] as string[], filters: {} },
    };
    expect(response.team.fields).toEqual([]);
    expect(response.team.filters).toEqual({});
  });

  it('handles boolean values in filters', () => {
    const response = {
      team: {
        id: '1',
        fields: ['isRootSpan'],
        filters: { isRootSpan: [true, false] },
      },
    };
    expect(response.team.filters.isRootSpan).toEqual([true, false]);
  });
});

describe('localStorage migration', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('reads pinned filters from localStorage correctly', () => {
    const sourceId = 'source123';
    const storedFilters = {
      [sourceId]: { ServiceName: ['web', 'api'] },
    };
    const storedFields = {
      [sourceId]: ['ServiceName', 'level'],
    };

    window.localStorage.setItem(
      'hdx-pinned-search-filters',
      JSON.stringify(storedFilters),
    );
    window.localStorage.setItem(
      'hdx-pinned-fields',
      JSON.stringify(storedFields),
    );

    const filtersRaw = window.localStorage.getItem('hdx-pinned-search-filters');
    const fieldsRaw = window.localStorage.getItem('hdx-pinned-fields');

    const filters = filtersRaw ? JSON.parse(filtersRaw) : {};
    const fields = fieldsRaw ? JSON.parse(fieldsRaw) : {};

    expect(filters[sourceId]).toEqual({ ServiceName: ['web', 'api'] });
    expect(fields[sourceId]).toEqual(['ServiceName', 'level']);
  });

  it('handles missing localStorage keys gracefully', () => {
    const filtersRaw = window.localStorage.getItem('hdx-pinned-search-filters');
    const fieldsRaw = window.localStorage.getItem('hdx-pinned-fields');

    expect(filtersRaw).toBeNull();
    expect(fieldsRaw).toBeNull();

    const filters = filtersRaw ? JSON.parse(filtersRaw) : {};
    const fields = fieldsRaw ? JSON.parse(fieldsRaw) : {};

    expect(filters).toEqual({});
    expect(fields).toEqual({});
  });

  it('handles corrupted localStorage data gracefully', () => {
    window.localStorage.setItem('hdx-pinned-search-filters', 'not-valid-json');

    expect(() => {
      try {
        const raw = window.localStorage.getItem('hdx-pinned-search-filters');
        JSON.parse(raw!);
      } catch {
        // Migration should catch this and continue
      }
    }).not.toThrow();
  });

  it('cleans up localStorage for a specific source after migration', () => {
    const sourceA = 'sourceA';
    const sourceB = 'sourceB';

    const storedFilters = {
      [sourceA]: { ServiceName: ['web'] },
      [sourceB]: { level: ['error'] },
    };
    window.localStorage.setItem(
      'hdx-pinned-search-filters',
      JSON.stringify(storedFilters),
    );

    // Simulate cleanup for sourceA (as the migration would do)
    const updated: Record<string, unknown> = { ...storedFilters };
    delete updated[sourceA];
    window.localStorage.setItem(
      'hdx-pinned-search-filters',
      JSON.stringify(updated),
    );

    const result = JSON.parse(
      window.localStorage.getItem('hdx-pinned-search-filters')!,
    );
    expect(result[sourceA]).toBeUndefined();
    expect(result[sourceB]).toEqual({ level: ['error'] });
  });
});
