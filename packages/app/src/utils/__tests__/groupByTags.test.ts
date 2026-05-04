import { groupByTags } from '../groupByTags';

type Item = { name: string; tags: string[] };

const item = (name: string, tags: string[]): Item => ({ name, tags });

describe('groupByTags', () => {
  it('returns empty array for empty input', () => {
    expect(groupByTags([], null)).toEqual([]);
  });

  it('groups items by tag alphabetically', () => {
    const items = [
      item('a', ['zeta']),
      item('b', ['alpha']),
      item('c', ['zeta']),
    ];
    const groups = groupByTags(items, null);
    expect(groups).toEqual([
      { tag: 'alpha', items: [items[1]] },
      { tag: 'zeta', items: [items[0], items[2]] },
    ]);
  });

  it('places untagged items in an "Untagged" group at the end', () => {
    const items = [item('a', ['beta']), item('b', [])];
    const groups = groupByTags(items, null);
    expect(groups).toEqual([
      { tag: 'beta', items: [items[0]] },
      { tag: 'Untagged', items: [items[1]] },
    ]);
  });

  it('duplicates items with multiple tags into each group', () => {
    const items = [item('a', ['beta', 'alpha'])];
    const groups = groupByTags(items, null);
    expect(groups).toEqual([
      { tag: 'alpha', items: [items[0]] },
      { tag: 'beta', items: [items[0]] },
    ]);
  });

  it('returns only the filtered tag group when tagFilter is set', () => {
    const items = [
      item('a', ['alpha', 'beta']),
      item('b', ['beta']),
      item('c', ['gamma']),
    ];
    const groups = groupByTags(items, 'beta');
    expect(groups).toEqual([{ tag: 'beta', items: [items[0], items[1]] }]);
  });

  it('returns empty array when tagFilter matches no items', () => {
    const items = [item('a', ['alpha'])];
    expect(groupByTags(items, 'nonexistent')).toEqual([]);
  });

  it('handles all items being untagged', () => {
    const items = [item('a', []), item('b', [])];
    const groups = groupByTags(items, null);
    expect(groups).toEqual([{ tag: 'Untagged', items: [items[0], items[1]] }]);
  });
});
