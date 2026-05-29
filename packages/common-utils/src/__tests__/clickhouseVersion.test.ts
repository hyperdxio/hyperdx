import {
  compareClickHouseVersion,
  isClickHouseVersionAtLeast,
  parseClickHouseVersion,
  supportsDirectReadMap,
  supportsMergeTreeTextIndex,
} from '@/core/clickhouseVersion';

type ClickHouseVersionTuple = readonly [number, number, number, number];

describe('parseClickHouseVersion', () => {
  it('parses a full 4-part version string', () => {
    expect(parseClickHouseVersion('26.4.1.3')).toEqual([26, 4, 1, 3]);
  });

  it('parses a version with multi-digit components', () => {
    expect(parseClickHouseVersion('25.12.0.123')).toEqual([25, 12, 0, 123]);
  });

  it('defaults missing trailing components to 0', () => {
    expect(parseClickHouseVersion('26.4')).toEqual([26, 4, 0, 0]);
    expect(parseClickHouseVersion('26.4.1')).toEqual([26, 4, 1, 0]);
  });

  it('trims surrounding whitespace', () => {
    expect(parseClickHouseVersion('  26.4.1.3  ')).toEqual([26, 4, 1, 3]);
  });

  it('ignores trailing build metadata after the 4th component', () => {
    expect(parseClickHouseVersion('26.4.1.3-stable')).toEqual([26, 4, 1, 3]);
  });

  it('returns undefined for empty input', () => {
    expect(parseClickHouseVersion('')).toBeUndefined();
    expect(parseClickHouseVersion('   ')).toBeUndefined();
  });

  it('returns undefined when major or minor are not numeric', () => {
    expect(parseClickHouseVersion('abc.4.1.3')).toBeUndefined();
    expect(parseClickHouseVersion('26.xx.1.3')).toBeUndefined();
  });

  it('returns undefined when there are fewer than two components', () => {
    expect(parseClickHouseVersion('26')).toBeUndefined();
  });
});

describe('compareClickHouseVersion', () => {
  it('returns 0 for equal versions', () => {
    expect(compareClickHouseVersion([26, 4, 1, 3], [26, 4, 1, 3])).toBe(0);
  });

  it('compares by major first', () => {
    expect(
      compareClickHouseVersion([27, 0, 0, 0], [26, 99, 99, 99]),
    ).toBeGreaterThan(0);
  });

  it('compares by minor when major is equal', () => {
    expect(
      compareClickHouseVersion([26, 4, 0, 0], [26, 3, 99, 99]),
    ).toBeGreaterThan(0);
  });

  it('compares by patch when major and minor are equal', () => {
    expect(
      compareClickHouseVersion([26, 4, 2, 0], [26, 4, 1, 99]),
    ).toBeGreaterThan(0);
  });

  it('compares by tweak as the lowest-priority component', () => {
    expect(compareClickHouseVersion([26, 4, 1, 4], [26, 4, 1, 3])).toBe(1);
    expect(compareClickHouseVersion([26, 4, 1, 2], [26, 4, 1, 3])).toBe(-1);
  });
});

describe('isClickHouseVersionAtLeast', () => {
  const threshold = [26, 4, 1, 3] as const;

  it('accepts the exact threshold version', () => {
    expect(isClickHouseVersionAtLeast([26, 4, 1, 3], threshold)).toBe(true);
  });

  it('accepts versions above the threshold', () => {
    expect(isClickHouseVersionAtLeast([26, 4, 1, 4], threshold)).toBe(true);
    expect(isClickHouseVersionAtLeast([27, 0, 0, 0], threshold)).toBe(true);
  });

  it('rejects versions below the threshold', () => {
    expect(isClickHouseVersionAtLeast([26, 4, 1, 2], threshold)).toBe(false);
    expect(isClickHouseVersionAtLeast([26, 4, 0, 99], threshold)).toBe(false);
    expect(isClickHouseVersionAtLeast([26, 2, 0, 0], threshold)).toBe(false);
    expect(isClickHouseVersionAtLeast([25, 99, 99, 99], threshold)).toBe(false);
  });

  it('returns false when the version is unknown', () => {
    expect(isClickHouseVersionAtLeast(undefined, threshold)).toBe(false);
  });
});

describe('supportsDirectReadMap', () => {
  describe('26.2 backport branch (min 26.2.19.43)', () => {
    it.each<readonly [ClickHouseVersionTuple, boolean]>([
      [[26, 2, 19, 43], true],
      [[26, 2, 19, 44], true],
      [[26, 2, 20, 0], true],
      [[26, 2, 99, 99], true],
      [[26, 2, 19, 42], false],
      [[26, 2, 19, 0], false],
      [[26, 2, 18, 99], false],
      [[26, 2, 0, 0], false],
    ])('%j → %s', (version, expected) => {
      expect(supportsDirectReadMap(version)).toBe(expected);
    });
  });

  describe('26.3 backport branch (min 26.3.12.3)', () => {
    it.each<readonly [ClickHouseVersionTuple, boolean]>([
      [[26, 3, 12, 3], true],
      [[26, 3, 12, 4], true],
      [[26, 3, 13, 0], true],
      [[26, 3, 99, 99], true],
      [[26, 3, 12, 2], false],
      [[26, 3, 12, 0], false],
      [[26, 3, 11, 99], false],
      [[26, 3, 0, 0], false],
    ])('%j → %s', (version, expected) => {
      expect(supportsDirectReadMap(version)).toBe(expected);
    });
  });

  describe('26.4 backport branch (min 26.4.3.37)', () => {
    it.each<readonly [ClickHouseVersionTuple, boolean]>([
      [[26, 4, 3, 37], true],
      [[26, 4, 3, 38], true],
      [[26, 4, 4, 0], true],
      [[26, 4, 99, 99], true],
      [[26, 4, 3, 36], false],
      [[26, 4, 3, 0], false],
      [[26, 4, 2, 99], false],
      [[26, 4, 1, 3], false],
      [[26, 4, 0, 99], false],
    ])('%j → %s', (version, expected) => {
      expect(supportsDirectReadMap(version)).toBe(expected);
    });
  });

  describe('26.5+ baseline (always supported)', () => {
    it.each<readonly [ClickHouseVersionTuple, boolean]>([
      [[26, 5, 0, 0], true],
      [[26, 5, 0, 1], true],
      [[26, 5, 99, 99], true],
      [[26, 6, 0, 0], true],
      [[26, 99, 99, 99], true],
      [[27, 0, 0, 0], true],
      [[30, 1, 2, 3], true],
    ])('%j → %s', (version, expected) => {
      expect(supportsDirectReadMap(version)).toBe(expected);
    });
  });

  describe('unsupported branches', () => {
    it.each<readonly [ClickHouseVersionTuple, boolean]>([
      [[26, 1, 99, 99], false],
      [[26, 0, 0, 0], false],
      [[25, 12, 0, 0], false],
      [[25, 99, 99, 99], false],
      [[24, 0, 0, 0], false],
    ])('%j → %s', (version, expected) => {
      expect(supportsDirectReadMap(version)).toBe(expected);
    });
  });

  it('returns false when the version is undefined', () => {
    expect(supportsDirectReadMap(undefined)).toBe(false);
  });
});

describe('supportsMergeTreeTextIndex', () => {
  it.each<readonly [ClickHouseVersionTuple, boolean]>([
    [[26, 3, 0, 0], true],
    [[26, 3, 0, 1], true],
    [[26, 3, 99, 99], true],
    [[26, 4, 0, 0], true],
    [[27, 0, 0, 0], true],
    [[26, 2, 99, 99], false],
    [[26, 2, 0, 0], false],
    [[26, 1, 0, 0], false],
    [[25, 12, 0, 0], false],
    [[24, 0, 0, 0], false],
  ])('%j → %s', (version, expected) => {
    expect(supportsMergeTreeTextIndex(version)).toBe(expected);
  });

  it('returns false when the version is undefined', () => {
    expect(supportsMergeTreeTextIndex(undefined)).toBe(false);
  });
});
