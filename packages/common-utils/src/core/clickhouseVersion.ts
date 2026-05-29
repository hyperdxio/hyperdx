export type ClickHouseVersion = readonly [
  major: number,
  minor: number,
  patch: number,
  tweak: number,
];

/**
 * Parses a ClickHouse `version()` string (e.g. "26.4.1.3" or "25.12.0.1") into a
 * 4-tuple. Missing trailing components default to 0. Returns undefined if the
 * leading major.minor cannot be parsed as integers.
 */
export function parseClickHouseVersion(
  version: string,
): ClickHouseVersion | undefined {
  const trimmed = version.trim();
  if (!trimmed) return undefined;

  const parts = trimmed.split('.', 5);
  if (parts.length < 2) return undefined;

  const nums: number[] = [];
  for (let i = 0; i < 4; i++) {
    const raw = parts[i] ?? '0';
    const match = raw.match(/^\d+/);
    if (!match) {
      if (i < 2) return undefined;
      nums.push(0);
      continue;
    }
    const n = Number.parseInt(match[0], 10);
    if (!Number.isFinite(n)) {
      if (i < 2) return undefined;
      nums.push(0);
      continue;
    }
    nums.push(n);
  }

  return [nums[0], nums[1], nums[2], nums[3]] as const;
}

export function compareClickHouseVersion(
  a: ClickHouseVersion,
  b: ClickHouseVersion,
): number {
  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export function isClickHouseVersionAtLeast(
  version: ClickHouseVersion | undefined,
  min: ClickHouseVersion,
): boolean {
  if (!version) return false;
  return compareClickHouseVersion(version, min) >= 0;
}

/**
 * Per-branch minimum versions required for the direct_read map column
 * optimization that compiles `Map['key'] = 'value'` filters into
 * `has(<MapItems>, concat('key', '=', 'value'))`.
 *
 * ClickHouse backported the feature into multiple stable release lines, so
 * there is no single threshold — each major.minor branch has its own cutoff:
 *
 *   - 26.2 branch → first available at 26.2.19.43
 *   - 26.3 branch → first available at 26.3.12.3
 *   - 26.4 branch → first available at 26.4.3.37
 *   - 26.5+       → always supported (feature shipped in mainline)
 *
 * Earlier 26.x branches (26.0, 26.1) and anything < 26 never received the
 * backport and are considered unsupported.
 *
 * Listed in ascending order — the highest entry defines the last branch that
 * required a backport; everything above `DIRECT_READ_MAP_BASELINE` is on by
 * default.
 */
const DIRECT_READ_MAP_BACKPORT_MINS: ReadonlyArray<ClickHouseVersion> = [
  [26, 2, 19, 43],
  [26, 3, 12, 3],
  [26, 4, 3, 37],
];

/**
 * First release where direct_read map support shipped unconditionally. Any
 * server with major.minor at or above this is considered supported, even if
 * its branch is not present in `DIRECT_READ_MAP_BACKPORT_MINS`.
 */
const DIRECT_READ_MAP_BASELINE: ClickHouseVersion = [26, 5, 0, 0];

/**
 * Returns true when the connected ClickHouse server supports the direct_read
 * map column optimization. Returns false when the version is undefined or
 * predates every known backport.
 */
export function supportsDirectReadMap(
  version: ClickHouseVersion | undefined,
): boolean {
  if (!version) return false;

  if (compareClickHouseVersion(version, DIRECT_READ_MAP_BASELINE) >= 0) {
    return true;
  }

  const [vMajor, vMinor] = version;
  const branchMin = DIRECT_READ_MAP_BACKPORT_MINS.find(
    ([major, minor]) => major === vMajor && minor === vMinor,
  );
  if (!branchMin) return false;
  return compareClickHouseVersion(version, branchMin) >= 0;
}

/**
 * First release that shipped the `mergeTreeTextIndex(database, table, index)`
 * table function used to introspect text skip indices.
 */
const MERGE_TREE_TEXT_INDEX_MIN: ClickHouseVersion = [26, 3, 0, 0];

/**
 * Returns true when the connected ClickHouse server supports the
 * `mergeTreeTextIndex` table function (>= 26.3). Returns false when the
 * version is undefined or older.
 */
export function supportsMergeTreeTextIndex(
  version: ClickHouseVersion | undefined,
): boolean {
  return isClickHouseVersionAtLeast(version, MERGE_TREE_TEXT_INDEX_MIN);
}
