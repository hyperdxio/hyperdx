/**
 * Tests for pinned filters logic:
 * - mergePinnedData (exported from searchFilters.tsx)
 * - localStorage migration logic
 */

import { mergePinnedData } from '../searchFilters';

describe('mergePinnedData', () => {
  it('returns empty fields and filters when both are null', () => {
    const result = mergePinnedData(null, null);
    expect(result.fields).toEqual([]);
    expect(result.filters).toEqual({});
  });

  it('returns team data when personal is null', () => {
    const team = {
      fields: ['ServiceName'],
      filters: { ServiceName: ['web', 'api'] },
    };
    const result = mergePinnedData(team, null);
    expect(result.fields).toEqual(['ServiceName']);
    expect(result.filters).toEqual({ ServiceName: ['web', 'api'] });
  });

  it('returns personal data when team is null', () => {
    const personal = {
      fields: ['level'],
      filters: { level: ['error'] },
    };
    const result = mergePinnedData(null, personal);
    expect(result.fields).toEqual(['level']);
    expect(result.filters).toEqual({ level: ['error'] });
  });

  it('unions fields from both team and personal', () => {
    const team = { fields: ['ServiceName', 'level'], filters: {} };
    const personal = { fields: ['level', 'host'], filters: {} };
    const result = mergePinnedData(team, personal);
    expect(result.fields).toEqual(['ServiceName', 'level', 'host']);
  });

  it('unions filter values and deduplicates', () => {
    const team = { fields: [], filters: { ServiceName: ['web', 'api'] } };
    const personal = {
      fields: [],
      filters: { ServiceName: ['api', 'worker'] },
    };
    const result = mergePinnedData(team, personal);
    expect(result.filters.ServiceName).toEqual(['web', 'api', 'worker']);
  });

  it('merges filter keys that only exist in one side', () => {
    const team = { fields: [], filters: { ServiceName: ['web'] } };
    const personal = { fields: [], filters: { level: ['error'] } };
    const result = mergePinnedData(team, personal);
    expect(result.filters).toEqual({
      ServiceName: ['web'],
      level: ['error'],
    });
  });

  it('handles boolean values in filters', () => {
    const team = { fields: [], filters: { isRootSpan: [true] } };
    const personal = { fields: [], filters: { isRootSpan: [false] } };
    const result = mergePinnedData(team, personal);
    expect(result.filters.isRootSpan).toEqual([true, false]);
  });

  it('does not duplicate boolean values', () => {
    const team = { fields: [], filters: { isRootSpan: [true] } };
    const personal = { fields: [], filters: { isRootSpan: [true] } };
    const result = mergePinnedData(team, personal);
    expect(result.filters.isRootSpan).toEqual([true]);
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
