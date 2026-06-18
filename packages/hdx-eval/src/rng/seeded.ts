export type SeededRng = {
  next(): number;
  range(minInclusive: number, maxExclusive: number): number;
  intRange(minInclusive: number, maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  weightedPick<T>(items: readonly { value: T; weight: number }[]): T;
  hex(bytes: number): string;
};

export function mulberry32(seed: number): SeededRng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const range = (lo: number, hi: number): number => lo + next() * (hi - lo);

  const intRange = (lo: number, hi: number): number =>
    Math.floor(range(lo, hi));

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new Error('pick() called with empty array');
    }
    return items[intRange(0, items.length)];
  };

  const weightedPick = <T>(
    items: readonly { value: T; weight: number }[],
  ): T => {
    const total = items.reduce((s, i) => s + i.weight, 0);
    if (total <= 0) {
      throw new Error('weightedPick() requires positive total weight');
    }
    let roll = next() * total;
    for (const item of items) {
      roll -= item.weight;
      if (roll < 0) return item.value;
    }
    return items[items.length - 1].value;
  };

  const hex = (bytes: number): string => {
    let out = '';
    for (let i = 0; i < bytes; i++) {
      out += intRange(0, 256).toString(16).padStart(2, '0');
    }
    return out;
  };

  return { next, range, intRange, pick, weightedPick, hex };
}
