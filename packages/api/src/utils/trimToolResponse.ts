import logger from '@/utils/logger';

export interface TrimResult<T = any> {
  data: T;
  isTrimmed: boolean;
  /** What was trimmed and how much, for the tool result. Empty when nothing was trimmed. */
  notes: string[];
}

/**
 * One step of an ordered reduction. `path` uses dot segments, with `[]` for
 * "every element of this array": `patterns[].samples` is the samples array of
 * every pattern, `patterns[].samples[]` every sample in it.
 */
export type Reduction =
  | { path: string; keep: number } // keep the first `keep` elements of the array
  | { path: string; maxChars: number } // shorten longer strings, with "…(+N chars)"
  | { path: string; drop: true }; // remove the key

export interface TrimOptions {
  /**
   * Applied in order, each to every match, before the generic fallback. The
   * whole response is measured after each step, and trimming stops as soon as
   * it fits.
   */
  reductions?: Reduction[];
}

/**
 * Trims large data structures to prevent "Request Entity Too Large" errors
 * when multiple tool calls accumulate data in the conversation history.
 *
 * Returns `{ data, isTrimmed, notes }` so callers can cheaply check whether the
 * response was truncated without re-serializing, and tell the caller what was cut.
 */
export function trimToolResponse<T = any>(
  data: T,
  maxSize: number = 50000,
  options: TrimOptions = {},
): TrimResult<T> {
  const originalSize = JSON.stringify(data).length;

  // If data is within acceptable size, return as-is
  if (originalSize <= maxSize) {
    return { data, isTrimmed: false, notes: [] };
  }

  logger.warn(
    `Tool response too large, trimming data. Original Size: ${originalSize}, Max Size: ${maxSize}`,
  );

  const notes: string[] = [];
  let current: T = data;
  const reductions = options.reductions ?? [];
  if (reductions.length > 0) {
    current = structuredClone(data);
    for (const reduction of reductions) {
      const note = applyReduction(current, reduction);
      if (!note) continue; // nothing changed, so the size didn't either
      notes.push(note);
      const size = JSON.stringify(current).length;
      if (size <= maxSize) {
        return {
          data: current,
          isTrimmed: true,
          notes: [sizeNote(originalSize, size, maxSize), ...notes],
        };
      }
    }
  }

  // Fallback: per-key budget split and array cuts.
  const stats: FallbackStats = {
    arrays: [],
    strings: 0,
    charsRemoved: 0,
    markers: 0,
  };
  let trimmed: unknown = current;
  if (Array.isArray(current)) {
    trimmed = trimArray(current, maxSize, '', stats);
  } else if (typeof current === 'object' && current !== null) {
    trimmed = trimObject(current, maxSize, '', stats);
  } else if (typeof current === 'string') {
    trimmed = shortenToFit(current, maxSize, stats);
  } else {
    return { data: current, isTrimmed: notes.length > 0, notes };
  }

  // One line per path: a nested array is cut once per parent item.
  const cuts = new Map<string, { items: number; from: number; to: number }>();
  for (const a of stats.arrays) {
    const c = cuts.get(a.path) ?? { items: 0, from: 0, to: 0 };
    cuts.set(a.path, {
      items: c.items + 1,
      from: c.from + a.from,
      to: c.to + a.to,
    });
  }
  for (const [path, c] of cuts) {
    notes.push(
      c.items === 1
        ? `${path || 'result'}: cut from ${fmt(c.from)} to ${fmt(c.to)} items`
        : `${path}: cut in ${fmt(c.items)} items, from ${fmt(c.from)} to ${fmt(c.to)} elements in total`,
    );
  }
  if (stats.strings > 0) {
    notes.push(
      `${fmt(stats.strings)} long value(s) shortened (${fmt(stats.charsRemoved)} chars removed)`,
    );
  }
  if (stats.markers > 0) {
    notes.push(
      `${fmt(stats.markers)} value(s) too large to shorten replaced by {"__hdx_trimmed":true,"originalSize":N}`,
    );
  }
  const finalSize = JSON.stringify(trimmed).length;
  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    data: trimmed as T,
    isTrimmed: true,
    notes: [sizeNote(originalSize, finalSize, maxSize), ...notes],
  };
}

interface FallbackStats {
  arrays: { path: string; from: number; to: number }[];
  strings: number;
  charsRemoved: number;
  markers: number;
}

const fmt = (n: number) => n.toLocaleString('en-US');

const sizeNote = (from: number, to: number, max: number) =>
  `Response trimmed from ${fmt(from)} to ${fmt(to)} chars (limit ${fmt(max)}).`;

/**
 * `s` cut to `maxChars`, followed by "…(+N chars)". Returned unchanged when the
 * suffix would make it no shorter. Unlike `truncateString` (utils/common), the
 * suffix says how much was cut, which the agent needs to judge the value.
 */
export function shortenString(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  let keep = Math.max(0, maxChars);
  // Don't split a surrogate pair (JSON would carry a lone \udXXX escape).
  if (/[\uD800-\uDBFF]/.test(s.charAt(keep - 1))) keep--;
  const out = `${s.slice(0, keep)}…(+${fmt(s.length - keep)} chars)`;
  return out.length < s.length ? out : s;
}

// Shorten so that the JSON-encoded string fits `budget` (escaping can make it
// longer than the raw string, so a couple of passes may be needed).
function shortenToFit(s: string, budget: number, stats: FallbackStats): string {
  let keep = Math.min(s.length, budget);
  let out = shortenString(s, keep);
  for (let i = 0; i < 4 && keep > 0; i++) {
    const excess = JSON.stringify(out).length - budget;
    if (excess <= 0) break;
    keep = Math.max(0, keep - excess);
    out = shortenString(s, keep);
  }
  if (out !== s) {
    stats.strings++;
    stats.charsRemoved += s.length - out.length;
  }
  return out;
}

// Calls `onTarget(container, key)` for every value the path points at.
function visit(
  node: any,
  segments: string[],
  onTarget: (container: any, key: string | number) => void,
): void {
  if (node == null || typeof node !== 'object' || segments.length === 0) return;
  const [segment, ...rest] = segments;
  const each = segment.endsWith('[]');
  const name = each ? segment.slice(0, -2) : segment;

  if (!each) {
    if (!(name in node)) return;
    if (rest.length === 0) onTarget(node, name);
    else visit(node[name], rest, onTarget); // eslint-disable-line security/detect-object-injection
    return;
  }

  const arr = name ? node[name] : node; // eslint-disable-line security/detect-object-injection
  if (!Array.isArray(arr)) return;
  arr.forEach((item, i) => {
    if (rest.length === 0) onTarget(arr, i);
    else visit(item, rest, onTarget);
  });
}

// Applies one reduction in place; returns a note when it changed something.
function applyReduction(root: any, reduction: Reduction): string | undefined {
  const segments = reduction.path.split('.');
  let items = 0;
  let amount = 0;

  visit(root, segments, (container, key) => {
    const value = container[key]; // eslint-disable-line security/detect-object-injection
    if ('drop' in reduction) {
      if (Array.isArray(container)) return;
      delete container[key]; // eslint-disable-line security/detect-object-injection
      items++;
    } else if ('keep' in reduction) {
      if (Array.isArray(value) && value.length > reduction.keep) {
        amount += value.length - reduction.keep;
        container[key] = value.slice(0, reduction.keep); // eslint-disable-line security/detect-object-injection
        items++;
      }
    } else if (typeof value === 'string') {
      const out = shortenString(value, reduction.maxChars);
      if (out !== value) {
        amount += value.length - out.length;
        container[key] = out; // eslint-disable-line security/detect-object-injection
        items++;
      }
    }
  });

  if (items === 0) return undefined;
  if ('drop' in reduction)
    return `${reduction.path}: removed (${fmt(items)} items)`;
  if ('keep' in reduction)
    return `${reduction.path}: kept the first ${fmt(reduction.keep)} (${fmt(amount)} elements removed from ${fmt(items)} items)`;
  return `${reduction.path}: ${fmt(items)} value(s) cut to the first ${fmt(reduction.maxChars)} chars (${fmt(amount)} chars removed)`;
}

function trimArray(
  arr: any[],
  maxSize: number,
  path: string,
  stats: FallbackStats,
): any[] {
  // Keep reducing array size until it fits
  let result = [...arr];
  let resultSize = JSON.stringify(result).length;

  while (resultSize > maxSize && result.length > 10) {
    // Keep at least 10 items
    const newLength = Math.max(10, Math.floor(result.length * 0.7));
    result = result.slice(0, newLength);
    resultSize = JSON.stringify(result).length;
  }

  if (result.length < arr.length) {
    stats.arrays.push({ path, from: arr.length, to: result.length });
    logger.info(`Trimmed array from ${arr.length} to ${result.length} items`);
  }

  // If we're still over budget (e.g. some items are large), trim the large
  // items. Items within an equal share stay whole; the large ones split what is
  // left, so the shortened items add up to the array's budget.
  if (resultSize > maxSize) {
    const sizes = result.map(item => JSON.stringify(item).length);
    const share = Math.floor(maxSize / result.length);
    const smallTotal = sizes.reduce(
      (sum, s) => (s <= share ? sum + s : sum),
      0,
    );
    const largeCount = sizes.filter(s => s > share).length;
    // Over budget only through separators: no single item to shorten.
    if (largeCount === 0) return result;
    // n-1 commas and 2 brackets
    const itemBudget = Math.floor(
      (maxSize - smallTotal - (result.length + 1)) / largeCount,
    );
    result = result.map((item, i) => {
      if (sizes[i] <= itemBudget) return item; // eslint-disable-line security/detect-object-injection
      logger.info(
        `Trimming oversized array item (${sizes[i]} bytes > ${itemBudget} limit)`, // eslint-disable-line security/detect-object-injection
      );
      if (typeof item === 'string') {
        return shortenToFit(item, itemBudget, stats);
      }
      if (typeof item === 'object' && item !== null) {
        return Array.isArray(item)
          ? trimArray(item, itemBudget, `${path}[]`, stats)
          : trimObject(item, itemBudget, `${path}[]`, stats);
      }
      // Non-string scalar that is itself too large — return a truncation marker
      stats.markers++;
      return { __hdx_trimmed: true, originalSize: sizes[i] }; // eslint-disable-line security/detect-object-injection
    });
  }

  return result;
}

const TRIMMED_FLAG_LENGTH = '"__hdx_trimmed":true'.length;

// Keys in trimObject come exclusively from Object.entries() on internal tool
// response data — never from user-supplied HTTP input — so bracket-notation
// writes are not an injection risk; see inline eslint-disable comments below.
function trimObject(
  obj: any,
  maxSize: number,
  path: string,
  stats: FallbackStats,
): any {
  const entries = Object.entries(obj);
  if (entries.length === 0) return obj;

  const result: any = {};

  // Give each key an equal share of the budget so that no single large value
  // crowds out the rest (e.g. a large array at key[0] eating all the budget
  // before key[1] gets a chance to appear). The shares exclude what the
  // values don't control: braces, quoted keys, colons, commas and the
  // `"__hdx_trimmed":true` flag added below.
  const overhead = entries.reduce(
    (sum, [key]) => sum + JSON.stringify(key).length + 2,
    2 + TRIMMED_FLAG_LENGTH,
  );
  const perKeyBudget = Math.max(
    0,
    Math.floor((maxSize - overhead) / entries.length),
  );
  let trimmed = false;

  for (const [key, value] of entries) {
    const valueStr = JSON.stringify(value);
    const keyPath = path ? `${path}.${key}` : key;

    if (valueStr.length <= perKeyBudget) {
      result[key] = value; // eslint-disable-line security/detect-object-injection
    } else {
      logger.info(
        `Trimming oversized object value at key "${key}" (${valueStr.length} bytes > ${perKeyBudget} per-key budget)`,
      );
      if (Array.isArray(value)) {
        result[key] = trimArray(value, perKeyBudget, keyPath, stats); // eslint-disable-line security/detect-object-injection
      } else if (typeof value === 'object' && value !== null) {
        result[key] = trimObject(value, perKeyBudget, keyPath, stats); // eslint-disable-line security/detect-object-injection
      } else if (typeof value === 'string') {
        result[key] = shortenToFit(value, perKeyBudget, stats); // eslint-disable-line security/detect-object-injection
      } else {
        stats.markers++;
        result[key] = { __hdx_trimmed: true, originalSize: valueStr.length }; // eslint-disable-line security/detect-object-injection
      }
      trimmed = true;
    }
  }

  if (trimmed) {
    result.__hdx_trimmed = true;
  }

  return result;
}
