jest.mock('../api', () => ({ hdxServer: jest.fn() }));
jest.mock('../config', () => ({ IS_LOCAL_MODE: true }));
jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}));
jest.mock('nuqs', () => ({
  parseAsJson: jest.fn(),
  useQueryState: jest.fn(),
}));
jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn(),
  useQueryClient: jest.fn(),
}));
jest.mock('@/utils', () => ({ hashCode: jest.fn(() => 0) }));

import { fetchLocalDashboards, getLocalDashboardTags } from '../dashboard';

const STORAGE_KEY = 'hdx-local-dashboards';

beforeEach(() => {
  localStorage.clear();
});

describe('fetchLocalDashboards', () => {
  it('returns empty array when no dashboards exist', () => {
    expect(fetchLocalDashboards()).toEqual([]);
  });

  it('returns all stored dashboards', () => {
    const dashboards = [
      { id: 'a', name: 'Dashboard A', tiles: [], tags: [] },
      { id: 'b', name: 'Dashboard B', tiles: [], tags: [] },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dashboards));
    expect(fetchLocalDashboards()).toHaveLength(2);
  });
});

describe('getLocalDashboardTags', () => {
  it('returns empty array when no dashboards exist', () => {
    expect(getLocalDashboardTags()).toEqual([]);
  });

  it('returns empty array when dashboards have no tags', () => {
    const dashboards = [
      { id: 'a', name: 'A', tiles: [], tags: [] },
      { id: 'b', name: 'B', tiles: [], tags: [] },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dashboards));
    expect(getLocalDashboardTags()).toEqual([]);
  });

  it('collects tags from all dashboards', () => {
    const dashboards = [
      { id: 'a', name: 'A', tiles: [], tags: ['production'] },
      { id: 'b', name: 'B', tiles: [], tags: ['staging'] },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dashboards));
    expect(getLocalDashboardTags()).toEqual(
      expect.arrayContaining(['production', 'staging']),
    );
    expect(getLocalDashboardTags()).toHaveLength(2);
  });

  it('deduplicates tags that appear on multiple dashboards', () => {
    const dashboards = [
      { id: 'a', name: 'A', tiles: [], tags: ['production', 'infra'] },
      { id: 'b', name: 'B', tiles: [], tags: ['production', 'billing'] },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dashboards));
    const tags = getLocalDashboardTags();
    expect(tags).toHaveLength(3);
    expect(tags).toEqual(
      expect.arrayContaining(['production', 'infra', 'billing']),
    );
  });

  it('handles dashboards with undefined tags', () => {
    const dashboards = [
      { id: 'a', name: 'A', tiles: [] },
      { id: 'b', name: 'B', tiles: [], tags: ['ops'] },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dashboards));
    expect(getLocalDashboardTags()).toEqual(['ops']);
  });
});
