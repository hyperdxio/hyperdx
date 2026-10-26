export type Rng = {
  next(): number;
  pick<T>(items: T[]): T;
  weighted<T>(items: Array<[T, number]>): T;
  gauss(mean: number, sd: number): number;
};

// mulberry32: small, fast, seeded so tests are repeatable.
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    pick: items => items[Math.floor(next() * items.length)],
    weighted: items => {
      let r = next() * items.reduce((s, [, w]) => s + w, 0);
      for (const [v, w] of items) {
        r -= w;
        if (r <= 0) return v;
      }
      return items[items.length - 1][0];
    },
    gauss: (mean, sd) => {
      const u = 1 - next(),
        v = next();
      return Math.max(
        1,
        mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v),
      );
    },
  };
}
