import { classifyShift } from '@/mcp/tools/query/emergingSignals';

describe('classifyShift', () => {
  const RATIO = 3;
  // Two sampled rows' worth of share for a 10k-row window (the tool's default
  // brand-new floor: 2 / sampledCount).
  const FLOOR = 2 / 10_000;

  describe('brand-new patterns (baseShare === 0)', () => {
    it('emerges when current share clears the floor', () => {
      expect(
        classifyShift({ curShare: FLOOR, baseShare: 0 }, RATIO, FLOOR),
      ).toBe('emerging');
      expect(
        classifyShift({ curShare: 0.05, baseShare: 0 }, RATIO, FLOOR),
      ).toBe('emerging');
    });

    it('is ignored when current share is a lone row below the floor', () => {
      expect(
        classifyShift({ curShare: FLOOR / 2, baseShare: 0 }, RATIO, FLOOR),
      ).toBeNull();
    });
  });

  describe('emerging via ratio', () => {
    it('reports an EXACTLY 3× shift at a 10k sample (float-boundary case)', () => {
      // At N=10000, 3 * (1/10000) rounds just above 3/10000, so a naive
      // cross-product drops this genuine 1→3 shift. The relative tolerance
      // admits it. This is the exact case Greptile flagged.
      const baseShare = 1 / 10_000;
      const curShare = 3 / 10_000;
      expect(classifyShift({ curShare, baseShare }, RATIO, FLOOR)).toBe(
        'emerging',
      );
    });

    it('reports an exact 3× shift at a small sample too', () => {
      expect(
        classifyShift({ curShare: 3 / 500, baseShare: 1 / 500 }, RATIO, FLOOR),
      ).toBe('emerging');
    });

    it('does NOT report a pattern clearly under ratio×', () => {
      const baseShare = 1 / 500;
      const curShare = 2 / 500; // 2× < 3×
      expect(classifyShift({ curShare, baseShare }, RATIO, FLOOR)).toBeNull();
    });

    it('does NOT over-admit just-below-threshold shifts (tolerance is tiny)', () => {
      // 2.9× must stay out — the relative tolerance is 1e-9, not a fudge factor.
      const baseShare = 1 / 10_000;
      const curShare = 2.9 / 10_000;
      expect(classifyShift({ curShare, baseShare }, RATIO, FLOOR)).toBeNull();
    });

    it('reports a pattern well above ratio×', () => {
      expect(
        classifyShift(
          { curShare: 10 / 10_000, baseShare: 1 / 10_000 },
          RATIO,
          FLOOR,
        ),
      ).toBe('emerging');
    });

    it('does not carry the old epsilon penalty (a clean shift is not suppressed)', () => {
      // Before the fix, `curShare / (baseShare + EPS)` pushed borderline shifts
      // just under the threshold. Cross-multiplication has no such bias: a
      // comfortably-above-3× shift always qualifies regardless of magnitude.
      expect(
        classifyShift(
          { curShare: 3.01 / 10_000, baseShare: 1 / 10_000 },
          RATIO,
          FLOOR,
        ),
      ).toBe('emerging');
    });
  });

  describe('disappeared', () => {
    it('reports a pattern absent from the current window', () => {
      expect(
        classifyShift({ curShare: 0, baseShare: 0.02 }, RATIO, FLOOR),
      ).toBe('disappeared');
    });

    it('reports a pattern that dropped at/above ratio× rarer', () => {
      // 3 baseline rows vs 1 current row → 3× rarer now.
      const baseShare = 3 / 500;
      const curShare = 1 / 500;
      expect(classifyShift({ curShare, baseShare }, RATIO, FLOOR)).toBe(
        'disappeared',
      );
    });

    it('reports an EXACTLY 3× drop at a 10k sample (float-boundary case)', () => {
      const baseShare = 3 / 10_000;
      const curShare = 1 / 10_000;
      expect(classifyShift({ curShare, baseShare }, RATIO, FLOOR)).toBe(
        'disappeared',
      );
    });

    it('does NOT report a pattern clearly under ratio× rarer', () => {
      const baseShare = 2 / 500; // 2× < 3×
      const curShare = 1 / 500;
      expect(classifyShift({ curShare, baseShare }, RATIO, FLOOR)).toBeNull();
    });
  });

  describe('stable patterns', () => {
    it('returns null for a pattern with similar share in both windows', () => {
      expect(
        classifyShift({ curShare: 0.01, baseShare: 0.01 }, RATIO, FLOOR),
      ).toBeNull();
    });

    it('does not report an equal-share pattern as emerging at minShareRatio=1', () => {
      // ratio=1 is schema-allowed. Without the directional guard, the relative
      // tolerance would make curShare >= 1 * baseShare * (1 - eps) true for a
      // stable pattern and flood the report with steady-state templates.
      expect(
        classifyShift({ curShare: 0.01, baseShare: 0.01 }, 1, FLOOR),
      ).toBeNull();
    });

    it('still reports a genuine increase at minShareRatio=1', () => {
      expect(classifyShift({ curShare: 0.02, baseShare: 0.01 }, 1, FLOOR)).toBe(
        'emerging',
      );
    });
  });
});
