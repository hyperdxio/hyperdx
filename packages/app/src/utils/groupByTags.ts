export type TagGroup<T> = { tag: string; items: T[] };

const UNTAGGED_GROUP_TAG = 'Untagged';

export function groupByTags<T extends { tags: string[] }>(
  items: T[],
  tagFilter: string | null,
): TagGroup<T>[] {
  const tagMap = new Map<string, T[]>();
  const untagged: T[] = [];

  for (const item of items) {
    if (item.tags.length === 0) {
      untagged.push(item);
    } else {
      for (const tag of item.tags) {
        if (!tagMap.has(tag)) tagMap.set(tag, []);
        tagMap.get(tag)!.push(item);
      }
    }
  }

  const groups: TagGroup<T>[] = [];

  if (tagFilter) {
    const filtered = tagMap.get(tagFilter);
    if (filtered) {
      groups.push({ tag: tagFilter, items: filtered });
    }
  } else {
    const sortedTags = Array.from(tagMap.keys()).sort();
    for (const tag of sortedTags) {
      groups.push({ tag, items: tagMap.get(tag)! });
    }
    if (untagged.length > 0) {
      groups.push({ tag: UNTAGGED_GROUP_TAG, items: untagged });
    }
  }

  return groups;
}
