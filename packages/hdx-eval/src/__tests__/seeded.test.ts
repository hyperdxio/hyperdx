import { mulberry32 } from '../rng/seeded';

describe('mulberry32', () => {
  it('produces an identical sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces a different sequence for a different seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(43);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('range() stays in [lo, hi)', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng.range(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(10);
    }
  });

  it('intRange() stays in [lo, hi) and returns integers', () => {
    const rng = mulberry32(2);
    for (let i = 0; i < 1000; i++) {
      const v = rng.intRange(0, 5);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
    }
  });

  it('pick() returns a deterministic element for a fixed seed', () => {
    const items = ['a', 'b', 'c', 'd'] as const;
    const v1 = mulberry32(99).pick(items);
    const v2 = mulberry32(99).pick(items);
    expect(v1).toBe(v2);
  });

  it('weightedPick() approximates the weight distribution', () => {
    const rng = mulberry32(7);
    const counts = { a: 0, b: 0 };
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const v = rng.weightedPick<'a' | 'b'>([
        { value: 'a', weight: 90 },
        { value: 'b', weight: 10 },
      ]);
      counts[v]++;
    }
    const ratioA = counts.a / N;
    expect(ratioA).toBeGreaterThan(0.85);
    expect(ratioA).toBeLessThan(0.94);
  });

  it('hex() returns the requested byte length as hex', () => {
    expect(mulberry32(1).hex(8)).toMatch(/^[0-9a-f]{16}$/);
    expect(mulberry32(1).hex(16)).toMatch(/^[0-9a-f]{32}$/);
  });
});
