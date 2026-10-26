const UNIT_NS: Record<string, number> = {
  ns: 1,
  us: 1e3,
  µs: 1e3,
  ms: 1e6,
  s: 1e9,
  m: 60e9,
  h: 3600e9,
};

const FORMAT_UNITS: Array<[string, number]> = [
  ['h', 3600e9],
  ['m', 60e9],
  ['s', 1e9],
  ['ms', 1e6],
  ['us', 1e3],
];

/** Parse a Lucene numeric bound, including duration units (`1s` → 1e9 ns). */
export function parseDurationBound(raw: string): number | null {
  const match = raw.match(/^(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)?$/i);
  if (!match) {
    return null;
  }
  const n = Number(match[1]);
  if (!Number.isFinite(n)) {
    return null;
  }
  const unit = match[2]?.toLowerCase() ?? '';
  return n * (UNIT_NS[unit] ?? 1);
}

/** Compact ns values that land on a duration unit (`1000000000` → `1s`). */
export function formatDurationBound(n: number): string {
  for (const [suffix, size] of FORMAT_UNITS) {
    if (n >= size && n % size === 0) {
      return `${n / size}${suffix}`;
    }
  }
  return String(n);
}
