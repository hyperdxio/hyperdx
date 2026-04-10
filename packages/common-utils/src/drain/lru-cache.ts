interface LruEntry<V> {
  key: number;
  value: V;
  prev: number | null;
  next: number | null;
}

/**
 * LRU cache with separate peek (no eviction update) and get (eviction update) methods.
 * This mirrors the behavior of Python's cachetools.LRUCache used in Drain3,
 * where LogClusterCache.get() bypasses eviction ordering.
 */
export class LruCache<V> {
  private capacity: number;
  private map: Map<number, number> = new Map();
  private entries: (LruEntry<V> | null)[] = [];
  private freeSlots: number[] = [];
  private head: number | null = null;
  private tail: number | null = null;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get size(): number {
    return this.map.size;
  }

  has(key: number): boolean {
    return this.map.has(key);
  }

  /** Read value without updating recency (used in fast_match). */
  peek(key: number): V | undefined {
    const slot = this.map.get(key);
    if (slot === undefined) return undefined;
    return this.entries[slot]?.value;
  }

  /** Read value and mark as most recently used. */
  get(key: number): V | undefined {
    const slot = this.map.get(key);
    if (slot === undefined) return undefined;
    this.moveToHead(slot);
    return this.entries[slot]?.value;
  }

  /** Insert or update. Returns the evicted [key, value] if cache was at capacity. */
  put(key: number, value: V): [number, V] | undefined {
    const existingSlot = this.map.get(key);
    if (existingSlot !== undefined) {
      const entry = this.entries[existingSlot]!;
      entry.value = value;
      this.moveToHead(existingSlot);
      return undefined;
    }

    let evicted: [number, V] | undefined;
    if (this.map.size >= this.capacity) {
      evicted = this.evictTail();
    }

    const slot = this.allocSlot({
      key,
      value,
      prev: null,
      next: this.head,
    });

    if (this.head !== null) {
      this.entries[this.head]!.prev = slot;
    }
    this.head = slot;
    if (this.tail === null) {
      this.tail = slot;
    }

    this.map.set(key, slot);
    return evicted;
  }

  remove(key: number): V | undefined {
    const slot = this.map.get(key);
    if (slot === undefined) return undefined;
    this.map.delete(key);
    this.unlink(slot);
    const entry = this.entries[slot]!;
    this.entries[slot] = null;
    this.freeSlots.push(slot);
    return entry.value;
  }

  values(): V[] {
    const result: V[] = [];
    for (const entry of this.entries) {
      if (entry !== null) {
        result.push(entry.value);
      }
    }
    return result;
  }

  private allocSlot(entry: LruEntry<V>): number {
    if (this.freeSlots.length > 0) {
      const slot = this.freeSlots.pop()!;
      this.entries[slot] = entry;
      return slot;
    }
    this.entries.push(entry);
    return this.entries.length - 1;
  }

  private unlink(slot: number): void {
    const entry = this.entries[slot]!;
    if (entry.prev !== null) {
      this.entries[entry.prev]!.next = entry.next;
    } else {
      this.head = entry.next;
    }
    if (entry.next !== null) {
      this.entries[entry.next]!.prev = entry.prev;
    } else {
      this.tail = entry.prev;
    }
  }

  private moveToHead(slot: number): void {
    if (this.head === slot) return;
    this.unlink(slot);
    const entry = this.entries[slot]!;
    entry.prev = null;
    entry.next = this.head;
    if (this.head !== null) {
      this.entries[this.head]!.prev = slot;
    }
    this.head = slot;
    if (this.tail === null) {
      this.tail = slot;
    }
  }

  private evictTail(): [number, V] | undefined {
    if (this.tail === null) return undefined;
    const tailSlot = this.tail;
    const entry = this.entries[tailSlot]!;
    const key = entry.key;
    const value = entry.value;
    this.map.delete(key);
    this.unlink(tailSlot);
    this.entries[tailSlot] = null;
    this.freeSlots.push(tailSlot);
    return [key, value];
  }
}
