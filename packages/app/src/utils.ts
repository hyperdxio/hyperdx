import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { formatDistanceToNowStrict } from 'date-fns';
import numbro from 'numbro';
import type { SetStateAction } from 'react';
import TimestampNano from 'timestamp-nano';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import {
  CATEGORICAL_PALETTE_TOKENS,
  ChartPaletteToken,
  ColorCondition,
  NumericUnit,
  SourceKind,
  TMetricSource,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { SortingState } from '@tanstack/react-table';

import { MetricsDataType, NumberFormat } from './types';

// From: https://usehooks.com/useWindowSize/
export function useWindowSize() {
  // Initialize state with undefined width/height so server and client renders match
  // Learn more here: https://joshwcomeau.com/react/the-perils-of-rehydration/
  const [windowSize, setWindowSize] = useState<{
    width: number | undefined;
    height: number | undefined;
  }>({
    width: undefined,
    height: undefined,
  });
  useEffect(() => {
    // Handler to call on window resize
    function handleResize() {
      // Set window width/height to state
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }
    // Add event listener
    window.addEventListener('resize', handleResize);
    // Call handler right away so state gets updated with initial window size
    handleResize();
    // Remove event listener on cleanup
    return () => window.removeEventListener('resize', handleResize);
  }, []); // Empty array ensures that effect is only run on mount
  return windowSize;
}

export const isValidUrl = (input: string) => {
  try {
    new URL(input);
    return true;
  } catch {
    return false;
  }
};

export const capitalizeFirstLetter = (input: string) => {
  return input.charAt(0).toUpperCase() + input.slice(1);
};

export const getShortUrl = (url: string) => {
  try {
    const parsedUrl = new URL(url);
    const urlSplit = (parsedUrl.pathname || url)
      ?.split('/')
      .filter((v: string) => v.length > 0); // Get rid of empty string
    let shortUrl = `/${urlSplit[urlSplit.length - 1] ?? url}`;
    for (let i = 3; i > 0; i--) {
      const urlSuffix = `/${urlSplit.slice(-1 * i).join('/')}`;
      if (urlSuffix.length < 25) {
        shortUrl = urlSuffix;
        break;
      }
    }

    return shortUrl;
  } catch {
    return '';
  }
};

export const useDebugMode = () => {
  const { query } = useRouter();

  return Boolean(query.debugMode) || Boolean(query.debug);
};

const returnFalse = () => false;

// From: https://usehooks.com/useDebounce/
export const useDebounce = <T>(
  value: T,
  delay: number,
  immediate?: (value: T) => boolean,
) => {
  // State and setters for debounced value
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  const shouldBeImmediate = (immediate ?? returnFalse)(value);
  useEffect(
    () => {
      if (shouldBeImmediate) {
        setDebouncedValue(value);
        return () => {};
      }

      // Update debounced value after delay
      const handler = setTimeout(() => {
        setDebouncedValue(value);
      }, delay);
      // Cancel the timeout if value changes (also on delay change or unmount)
      // This is how we prevent debounced value from updating if value is changed ...
      // .. within the delay period. Timeout gets cleared and restarted.
      return () => {
        clearTimeout(handler);
      };
    },
    [value, delay, shouldBeImmediate], // Only re-call effect if value or delay changes
  );
  if (shouldBeImmediate) {
    return value;
  }

  return debouncedValue;
};

// localStorage key for query
export const QUERY_LOCAL_STORAGE = {
  KEY: 'QuerySearchHistory',
  SEARCH_SQL: 'searchSQL',
  SEARCH_LUCENE: 'searchLucene',
  LIMIT: 10, // cache up to 10
};

function getLocalStorageValue<T>(key: string): T | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const item = window.localStorage.getItem(key);
    return item != null ? JSON.parse(item) : null;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.log(error);
    return null;
  }
}

export interface CustomStorageChangeDetail {
  key: string;
  instanceId: string;
}

export function useLocalStorage<T>(key: string, initialValue: T) {
  // State to store our value
  // Pass initial state function to useState so logic is only executed once
  const [storedValue, setStoredValue] = useState<T>(
    getLocalStorageValue<T>(key) ?? initialValue,
  );

  // Create a unique ID for this hook instance
  const [instanceId] = useState(() =>
    Math.random().toString(36).substring(2, 9),
  );

  useEffect(() => {
    const handleCustomStorageChange = (event: Event) => {
      if (
        event instanceof CustomEvent &&
        event.detail.key === key &&
        event.detail.instanceId !== instanceId
      ) {
        setStoredValue(getLocalStorageValue<T>(key)!);
      }
    };
    const handleStorageChange = (event: Event) => {
      if (event instanceof StorageEvent && event.key === key) {
        setStoredValue(getLocalStorageValue<T>(key)!);
      }
    };
    // check if local storage changed from current window
    window.addEventListener('customStorage', handleCustomStorageChange);
    // check if local storage changed from another window
    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('customStorage', handleCustomStorageChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [instanceId, key]);

  // Fetch the value on client-side to avoid SSR issues
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      // Get from local storage by key
      const item = window.localStorage.getItem(key);
      // Parse stored json or if none return initialValue
      if (item != null) {
        setStoredValue(JSON.parse(item));
      }
    } catch (error) {
      // If error also return initialValue
      // eslint-disable-next-line no-console
      console.log(error);
    }
  }, [key]);

  // Return a wrapped version of useState's setter function that ...
  // ... persists the new value to localStorage.
  const setValue = useCallback(
    (value: SetStateAction<T>) => {
      if (typeof window === 'undefined') {
        return;
      }
      try {
        // Allow value to be a function so we have same API as useState
        // Save state
        setStoredValue(prev => {
          const newValue = value instanceof Function ? value(prev) : value;
          window.localStorage.setItem(key, JSON.stringify(newValue));
          return newValue;
        });
        // Fire off event so other localStorage hooks listening with the same key
        // will update
        const event = new CustomEvent<CustomStorageChangeDetail>(
          'customStorage',
          {
            detail: {
              key,
              instanceId,
            },
          },
        );
        window.dispatchEvent(event);
      } catch (error) {
        // A more advanced implementation would handle the error case
        // eslint-disable-next-line no-console
        console.log(error);
      }
    },
    [instanceId, key],
  );

  return [storedValue, setValue] as const;
}

export function useQueryHistory(type: string | undefined) {
  const key = `${QUERY_LOCAL_STORAGE.KEY}.${type}`;
  const [queryHistory, _setQueryHistory] = useLocalStorage<string[]>(key, []);
  const setQueryHistory = useCallback(
    (query: string) => {
      // do not set up anything if there is no type or empty query
      try {
        const trimmed = query.trim();
        if (!type || !trimmed) return null;
        const deduped = [trimmed, ...queryHistory.filter(q => q !== trimmed)];
        const limited = deduped.slice(0, QUERY_LOCAL_STORAGE.LIMIT);
        _setQueryHistory(limited);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.log(`Failed to cache query history, error ${e.message}`);
      }
    },
    [_setQueryHistory, queryHistory, type],
  );
  return [queryHistory, setQueryHistory] as const;
}

export function useIntersectionObserver(onIntersect: () => void) {
  const observer = useRef<IntersectionObserver | null>(null);
  const observerRef = useCallback(
    (node: Element | null) => {
      if (observer.current) observer.current.disconnect();
      observer.current = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) {
          onIntersect();
        }
      });
      if (node) observer.current.observe(node);
    },
    [onIntersect],
  );

  return { observerRef };
}

export function truncateText(
  text: string,
  maxLength: number,
  suffix?: string,
  endPattern?: RegExp,
) {
  const patternIndex = endPattern ? text.search(endPattern) : -1;
  // Return truncated text at index
  if (patternIndex >= 0 && patternIndex < maxLength) {
    return text.substring(0, patternIndex) + '...';
  }

  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + (suffix ?? '...');
}

export function formatDistanceToNowStrictShort(date: Date) {
  return formatDistanceToNowStrict(date)
    .replace(' month', 'mo.')
    .replace(' days', 'd')
    .replace(' day', 'd')
    .replace(' hours', 'h')
    .replace(' hour', 'h')
    .replace(' minutes', 'm')
    .replace(' minute', 'm')
    .replace(' seconds', 's');
}

export function formatmmss(milliseconds?: number) {
  if (milliseconds == null) {
    return '--:--';
  }

  const value = Math.max(milliseconds, 0);
  const minutes = Math.floor(value / 1000 / 60);
  const seconds = Math.floor((value / 1000) % 60);

  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

export const getLogLevelClass = (lvl: string | undefined) => {
  const level = lvl?.toLowerCase();
  if (level == null) {
    return undefined;
  }

  return level.startsWith('emerg') ||
    level.startsWith('alert') ||
    level.startsWith('crit') ||
    level.startsWith('err') ||
    level.startsWith('fatal')
    ? 'error'
    : level.startsWith('warn')
      ? 'warn'
      : level.startsWith('info') ||
          level.startsWith('debug') ||
          level.startsWith('ok') ||
          level.startsWith('notice') ||
          level.startsWith('verbose') ||
          level.startsWith('unset') ||
          level.startsWith('trace')
        ? 'info'
        : undefined;
};

/**
 * Chart Categorical Palette - ten distinguishable hues based on
 * Observable 10 (https://observablehq.com/@d3/color-schemes), with
 * `chart-blue` swapped to `#437eef` to match the brand link color
 * (`--click-global-color-text-link-default`). All other hues are
 * straight from Observable 10. Unified across themes.
 *
 * **JS is the source of truth for categorical hues.** Both HyperDX and
 * ClickStack resolve `--color-chart-{hue}` to the same hex today, so
 * the JS readers (`getColorFromCSSVariable`, `getColorFromCSSToken`)
 * return values directly from this object without round-tripping
 * through `getComputedStyle`. The matching `--color-chart-{hue}` CSS
 * vars in `_tokens.scss` exist as a stylesheet-author affordance only
 * (inline `var()` use, devtools inspection); they are NOT read back by
 * the React rendering path. Per-brand identity is carried by the
 * semantic chart tokens below and by non-chart UI chrome (Mantine
 * accent, sidebar gradient, etc.).
 *
 * Keep in sync with `CATEGORICAL_PALETTE_TOKENS` in
 * `@hyperdx/common-utils/dist/types` and with the `--color-chart-{hue}`
 * vars in `packages/app/src/theme/themes/_chart-categorical-tokens.scss`
 * (the single shared SCSS source for categorical hues; both brand
 * themes `@use` it).
 */
type CategoricalChartPaletteToken = (typeof CATEGORICAL_PALETTE_TOKENS)[number];

const CATEGORICAL_HEX_BY_TOKEN = {
  'chart-blue': '#437eef',
  'chart-orange': '#efb118',
  'chart-red': '#ff725c',
  'chart-cyan': '#6cc5b0',
  'chart-green': '#3ca951',
  'chart-pink': '#ff8ab7',
  'chart-purple': '#a463f2',
  'chart-light-blue': '#97bbf5',
  'chart-brown': '#9c6b4e',
  'chart-gray': '#9498a0',
} as const satisfies Record<CategoricalChartPaletteToken, string>;

// Reverse-direction completeness check: if `CATEGORICAL_HEX_BY_TOKEN`
// ever grows an extra key that's not in `CATEGORICAL_PALETTE_TOKENS`
// (e.g. a deprecated hex stuck around after dropping the token from the
// shared enum), this type collapses to `never` and the assignment below
// becomes a compile error. The `satisfies` above already enforces the
// forward direction (every categorical token has a hex), so together
// they pin the two structures to a 1:1 mapping at build time.
type _CategoricalHexCompleteness =
  Exclude<
    keyof typeof CATEGORICAL_HEX_BY_TOKEN,
    CategoricalChartPaletteToken
  > extends never
    ? true
    : never;
const _categoricalHexCompletenessCheck: _CategoricalHexCompleteness = true;
void _categoricalHexCompletenessCheck;

type SemanticChartColorKey =
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'successHighlight'
  | 'warningHighlight'
  | 'errorHighlight';

/**
 * Per-brand semantic chart palette. SSR / `getComputedStyle` fallback
 * for `getChartColor{Success,Warning,Error,Info,*Highlight}` helpers.
 * Live values come from `--color-chart-{success|warning|error|info}[-highlight]`
 * in `_chart-categorical-tokens.scss` (`chart-semantic-tokens` mixin).
 *
 * Kept per-brand (instead of collapsed to one object) so the
 * `Record<'hyperdx' | 'clickstack', SemanticChartHexes>` constraint
 * forces both brands to declare every semantic key — dropping or
 * renaming one in either entry becomes a compile error rather than a
 * silent runtime divergence between SSR and client. The two entries
 * are byte-identical today; collapse to a flat object if and when a
 * brand actually needs to diverge.
 */
type SemanticChartHexes = Readonly<Record<SemanticChartColorKey, string>>;

const SEMANTIC_CHART_PALETTE: Readonly<
  Record<'hyperdx' | 'clickstack', SemanticChartHexes>
> = {
  hyperdx: {
    success: '#3ca951',
    warning: '#efb118',
    error: '#ff725c',
    info: '#437eef',
    successHighlight: '#80d9b3',
    warningHighlight: '#f5c94d',
    errorHighlight: '#ffa090',
  },
  clickstack: {
    success: '#3ca951',
    warning: '#efb118',
    error: '#ff725c',
    info: '#437eef',
    successHighlight: '#80d9b3',
    warningHighlight: '#f5c94d',
    errorHighlight: '#ffa090',
  },
};

/**
 * Ordered hex array for positional series assignment.
 * `COLORS[i]` === `CATEGORICAL_HEX_BY_TOKEN[CATEGORICAL_PALETTE_TOKENS[i]]`.
 * Returned directly by `getColorFromCSSVariable(i)` on both server and
 * client — the categorical palette is unified across themes, so there's
 * no benefit to reading the matching CSS var via `getComputedStyle`.
 *
 * Typed as `readonly string[]` (not `string[]`) because the array is a
 * derived snapshot of `CATEGORICAL_HEX_BY_TOKEN` — mutating it in place
 * would desync the two structures the completeness check above pins
 * together. `CATEGORICAL_PALETTE_TOKENS` is a `readonly` tuple of
 * `CategoricalChartPaletteToken` already, so the `.map` callback's
 * `token` parameter is the narrow union and `CATEGORICAL_HEX_BY_TOKEN`
 * index lookup is exhaustive without further assertion.
 */
export const COLORS: readonly string[] = CATEGORICAL_PALETTE_TOKENS.map(
  token => CATEGORICAL_HEX_BY_TOKEN[token],
);

/**
 * Palette token types and runtime guards live in common-utils so the
 * Zod schema in `SharedChartSettingsSchema` can reference them; the
 * theme-aware CSS resolver `getColorFromCSSToken` below stays in app
 * because it depends on `getComputedStyle(document.documentElement)`.
 *
 * Re-exported here so existing app-side imports from `@/utils` keep
 * working unchanged.
 */
export {
  CATEGORICAL_PALETTE_TOKENS,
  CHART_PALETTE_TOKENS,
  resolveChartPaletteToken,
  SEMANTIC_PALETTE_TOKENS,
} from '@hyperdx/common-utils/dist/types';
export type { ChartPaletteToken };

/**
 * Detects the active theme by checking for theme classes on documentElement.
 * Returns 'clickstack' if theme-clickstack class is present, 'hyperdx' otherwise.
 * Note: classList.contains() is O(1) and fast - no caching needed.
 */
function detectActiveTheme(): 'clickstack' | 'hyperdx' {
  if (typeof window === 'undefined') {
    // SSR: default to hyperdx (can't detect theme without DOM)
    return 'hyperdx';
  }

  try {
    const isClickStack =
      document.documentElement.classList.contains('theme-clickstack');
    return isClickStack ? 'clickstack' : 'hyperdx';
  } catch {
    // Fallback if DOM access fails
    return 'hyperdx';
  }
}

/**
 * Returns the Nth categorical chart hex by series index. Index wraps
 * modulo `CATEGORICAL_PALETTE_TOKENS.length`.
 *
 * Reads from the JS palette directly. The matching `--color-chart-{hue}`
 * CSS var resolves to the same hex on every theme today, so the
 * previous `getComputedStyle` round-trip added a layout read per series
 * with no functional benefit. If a future brand wants to override hues,
 * reintroduce the DOM read here (and add per-brand entries to
 * `CATEGORICAL_HEX_BY_TOKEN`).
 */
function getColorFromCSSVariable(index: number): string {
  const i = index % CATEGORICAL_PALETTE_TOKENS.length;
  return COLORS[i];
}

/**
 * Resolves a chart palette token to a hex string.
 *
 * Categorical hue tokens (`chart-blue`, `chart-orange`, ...) come
 * straight from `CATEGORICAL_HEX_BY_TOKEN` — the palette is unified
 * across themes, so the matching `--color-chart-{hue}` CSS var would
 * always resolve to the same value, and skipping `getComputedStyle`
 * avoids an unnecessary layout read per series.
 *
 * Semantic tokens (`chart-success`, `-warning`, `-error`) DO vary per
 * brand, so they read the matching CSS var (`--color-chart-{name}`)
 * via `getComputedStyle` and fall back to the active theme's entry in
 * `SEMANTIC_CHART_PALETTE` for SSR / `getComputedStyle` failures.
 *
 * @example
 *   getColorFromCSSToken('chart-blue')     // Observable blue (both themes)
 *   getColorFromCSSToken('chart-warning')  // theme-aware warning
 */
export function getColorFromCSSToken(token: ChartPaletteToken): string {
  if (isCategoricalChartPaletteToken(token)) {
    return CATEGORICAL_HEX_BY_TOKEN[token];
  }

  // After the categorical short-circuit, `token` is narrowed to a
  // semantic token (`chart-success`/`chart-warning`/`chart-error`)
  // — the parameter type that `semanticTokenFallback` enforces via
  // its exhaustiveness check.
  const semanticToken = token;
  const cssVarName = `--color-${semanticToken}`;

  if (typeof window === 'undefined') {
    return semanticTokenFallback(semanticToken);
  }

  try {
    const computedStyle = getComputedStyle(document.documentElement);
    const color = computedStyle.getPropertyValue(cssVarName).trim();
    if (color && color !== '') {
      return color;
    }
  } catch {
    // Fallback if getComputedStyle fails
  }

  return semanticTokenFallback(semanticToken);
}

function isCategoricalChartPaletteToken(
  token: ChartPaletteToken,
): token is keyof typeof CATEGORICAL_HEX_BY_TOKEN {
  return Object.prototype.hasOwnProperty.call(CATEGORICAL_HEX_BY_TOKEN, token);
}

function semanticTokenFallback(
  token: Exclude<ChartPaletteToken, CategoricalChartPaletteToken>,
): string {
  switch (token) {
    case 'chart-success':
    case 'chart-warning':
    case 'chart-error': {
      const theme = detectActiveTheme();
      const key = token.slice('chart-'.length) as
        | 'success'
        | 'warning'
        | 'error';
      return SEMANTIC_CHART_PALETTE[theme][key];
    }
    default: {
      // Exhaustiveness assertion: if a new semantic token lands on
      // `ChartPaletteToken` without a matching case above, this line
      // becomes a compile error. The fallback was previously
      // `COLORS[0]` with a "brand-primary" comment, but that path is
      // unreachable through the parameter type and silently masked
      // future drift.
      const _exhaustive: never = token;
      throw new Error(`Unhandled semantic chart token: ${_exhaustive}`);
    }
  }
}

/**
 * Evaluates a single conditional color rule against a runtime value.
 *
 * Numeric operators (`gt`, `gte`, `lt`, `lte`, `between`) return false when
 * `typeof value !== 'number'`. Equality operators (`eq`, `neq`) use strict
 * comparison — cross-type mismatches (`"5"` vs `5`) return false. String
 * operators (`contains`, `startsWith`, `endsWith`, `regex`) return false when
 * `typeof value !== 'string'`. Bad regex patterns are silently treated as
 * no-match (schema `.refine` is best-effort; this is the runtime safety net).
 */
export function evaluateColorCondition(
  value: number | string,
  rule: ColorCondition,
): boolean {
  switch (rule.operator) {
    case 'gt':
      return typeof value === 'number' && value > rule.value;
    case 'gte':
      return typeof value === 'number' && value >= rule.value;
    case 'lt':
      return typeof value === 'number' && value < rule.value;
    case 'lte':
      return typeof value === 'number' && value <= rule.value;
    case 'between': {
      if (typeof value !== 'number') return false;
      const [a, b] = rule.value;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      return value >= lo && value <= hi;
    }
    case 'eq':
      return value === rule.value;
    case 'neq':
      return value !== rule.value;
    case 'contains':
      return typeof value === 'string' && value.includes(rule.value);
    case 'startsWith':
      return typeof value === 'string' && value.startsWith(rule.value);
    case 'endsWith':
      return typeof value === 'string' && value.endsWith(rule.value);
    case 'regex':
      if (typeof value !== 'string') return false;
      try {
        return new RegExp(rule.value).test(value);
      } catch {
        return false;
      }
  }
}

/**
 * Resolves the display color for a number tile by evaluating ordered
 * conditional color rules against the tile's current value.
 *
 * Rules are evaluated in order; the LAST matching rule's color wins
 * (Grafana threshold semantics). When no rule matches, `fallback` is
 * returned. When `value` is null/undefined or `rules` is empty,
 * `fallback` is returned immediately.
 *
 * @param value    The tile's current numeric (or string) value.
 * @param rules    Ordered list of conditional color rules from the config.
 * @param fallback The tile's static color (`config.color`) to use when no
 *                 rule matches, or undefined to use the default text color.
 */
export function resolveConditionalColor(
  value: number | string | null | undefined,
  rules: ColorCondition[] | undefined,
  fallback: ChartPaletteToken | undefined,
): ChartPaletteToken | undefined {
  if (!rules || rules.length === 0 || value == null) return fallback;
  let match: ChartPaletteToken | undefined = fallback;
  for (const rule of rules) {
    if (evaluateColorCondition(value, rule)) match = rule.color;
  }
  return match;
}

export function hashCode(str: string) {
  let hash = 0,
    i,
    chr;
  if (str.length === 0) return hash;
  for (i = 0; i < str.length; i++) {
    chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

/**
 * Theme-aware semantic chart color resolver. Reads `cssVarName` from
 * `documentElement` and falls back to the active theme's value from
 * `SEMANTIC_CHART_PALETTE` (HyperDX during SSR).
 *
 * Charts typically render client-side after data fetching, so hydration
 * mismatches between the SSR fallback and the live var are rare.
 */
function getSemanticChartColor(
  cssVarName: string,
  key: SemanticChartColorKey,
): string {
  if (typeof window === 'undefined') {
    return SEMANTIC_CHART_PALETTE.hyperdx[key];
  }

  try {
    const computedStyle = getComputedStyle(document.documentElement);
    const color = computedStyle.getPropertyValue(cssVarName).trim();
    if (color && color !== '') {
      return color;
    }
  } catch {
    // Fallback if getComputedStyle fails
  }

  return SEMANTIC_CHART_PALETTE[detectActiveTheme()][key];
}

// Semantic chart colors (theme-aware). Read from CSS variables with
// per-theme fallbacks in `SEMANTIC_CHART_PALETTE`.
export function getChartColorSuccess(): string {
  return getSemanticChartColor('--color-chart-success', 'success');
}

export function getChartColorWarning(): string {
  return getSemanticChartColor('--color-chart-warning', 'warning');
}

export function getChartColorError(): string {
  return getSemanticChartColor('--color-chart-error', 'error');
}

/** Chart blue used for info-level logs and similar "neutral / default"
 *  series. Same hue as categorical `chart-blue` on both brands. */
export function getChartColorInfo(): string {
  return getSemanticChartColor('--color-chart-info', 'info');
}

// Highlighted variants (theme-aware)
export function getChartColorSuccessHighlight(): string {
  return getSemanticChartColor(
    '--color-chart-success-highlight',
    'successHighlight',
  );
}

export function getChartColorErrorHighlight(): string {
  return getSemanticChartColor(
    '--color-chart-error-highlight',
    'errorHighlight',
  );
}

export function getChartColorWarningHighlight(): string {
  return getSemanticChartColor(
    '--color-chart-warning-highlight',
    'warningHighlight',
  );
}

// Try to match log levels to colors
export const semanticKeyedColor = (
  key: string | number | undefined,
  index: number,
) => {
  const logLevel = getLogLevelClass(`${key}`);
  if (logLevel != null) {
    return logLevel === 'error'
      ? getChartColorError()
      : logLevel === 'warn'
        ? getChartColorWarning()
        : getChartColorInfo();
  }

  // Use CSS variable for theme-aware colors, fallback to hardcoded array
  return getColorFromCSSVariable(index);
};

export const logLevelColor = (key: string | number | undefined) => {
  const logLevel = getLogLevelClass(`${key}`);
  return logLevel === 'error'
    ? getChartColorError()
    : logLevel === 'warn'
      ? getChartColorWarning()
      : getChartColorInfo();
};

// order of colors for sorting. primary color (blue/green) on bottom, then yellow, then red
// Computed lazily to avoid DOM access at module initialization (SSR-safe)
export function getLogLevelColorOrder(): string[] {
  return [logLevelColor('info'), logLevelColor('warn'), logLevelColor('error')];
}

const getLevelColor = (logLevel?: string) => {
  if (logLevel == null) {
    return;
  }
  return logLevel === 'error'
    ? getChartColorError()
    : logLevel === 'warn'
      ? getChartColorWarning()
      : getChartColorInfo();
};

export const getColorProps = (index: number, level: string): string => {
  const logLevel = getLogLevelClass(level);
  const colorOverride = getLevelColor(logLevel);

  // Use CSS variable for theme-aware colors, fallback to hardcoded array
  return colorOverride ?? getColorFromCSSVariable(index);
};

export const truncateMiddle = (str: string, maxLen = 10) => {
  const coercedStr = `${str}`;
  if (coercedStr.length <= maxLen) {
    return coercedStr;
  }
  return `${coercedStr.slice(0, (maxLen - 2) / 2)}..${coercedStr.slice(
    (-1 * (maxLen - 2)) / 2,
  )}`;
};

export const usePrevious = <T>(value: T): T | undefined => {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  });
  // eslint-disable-next-line react-hooks/refs
  return ref.current;
};

type AutoScaleUnitConfig = {
  type: 'auto_scale';
  base: 'iec' | 'si';
  isBits: boolean;
  perSec: boolean;
};

type FixedUnitConfig = {
  type: 'fixed';
  suffix: string;
};

type UnitFormatConfig = AutoScaleUnitConfig | FixedUnitConfig;

const NUMERIC_UNIT_CONFIGS: Record<NumericUnit, UnitFormatConfig> = {
  // Data
  [NumericUnit.BytesIEC]: {
    type: 'auto_scale',
    base: 'iec',
    isBits: false,
    perSec: false,
  },
  [NumericUnit.BytesSI]: {
    type: 'auto_scale',
    base: 'si',
    isBits: false,
    perSec: false,
  },
  [NumericUnit.BitsIEC]: {
    type: 'auto_scale',
    base: 'iec',
    isBits: true,
    perSec: false,
  },
  [NumericUnit.BitsSI]: {
    type: 'auto_scale',
    base: 'si',
    isBits: true,
    perSec: false,
  },
  [NumericUnit.Kibibytes]: { type: 'fixed', suffix: 'KiB' },
  [NumericUnit.Kilobytes]: { type: 'fixed', suffix: 'KB' },
  [NumericUnit.Mebibytes]: { type: 'fixed', suffix: 'MiB' },
  [NumericUnit.Megabytes]: { type: 'fixed', suffix: 'MB' },
  [NumericUnit.Gibibytes]: { type: 'fixed', suffix: 'GiB' },
  [NumericUnit.Gigabytes]: { type: 'fixed', suffix: 'GB' },
  [NumericUnit.Tebibytes]: { type: 'fixed', suffix: 'TiB' },
  [NumericUnit.Terabytes]: { type: 'fixed', suffix: 'TB' },
  [NumericUnit.Pebibytes]: { type: 'fixed', suffix: 'PiB' },
  [NumericUnit.Petabytes]: { type: 'fixed', suffix: 'PB' },
  // Data Rate
  [NumericUnit.PacketsSec]: { type: 'fixed', suffix: 'pkt/s' },
  [NumericUnit.BytesSecIEC]: {
    type: 'auto_scale',
    base: 'iec',
    isBits: false,
    perSec: true,
  },
  [NumericUnit.BytesSecSI]: {
    type: 'auto_scale',
    base: 'si',
    isBits: false,
    perSec: true,
  },
  [NumericUnit.BitsSecIEC]: {
    type: 'auto_scale',
    base: 'iec',
    isBits: true,
    perSec: true,
  },
  [NumericUnit.BitsSecSI]: {
    type: 'auto_scale',
    base: 'si',
    isBits: true,
    perSec: true,
  },
  [NumericUnit.KibibytesSec]: { type: 'fixed', suffix: 'KiB/s' },
  [NumericUnit.KibibitsSec]: { type: 'fixed', suffix: 'Kibit/s' },
  [NumericUnit.KilobytesSec]: { type: 'fixed', suffix: 'KB/s' },
  [NumericUnit.KilobitsSec]: { type: 'fixed', suffix: 'Kbit/s' },
  [NumericUnit.MebibytesSec]: { type: 'fixed', suffix: 'MiB/s' },
  [NumericUnit.MebibitsSec]: { type: 'fixed', suffix: 'Mibit/s' },
  [NumericUnit.MegabytesSec]: { type: 'fixed', suffix: 'MB/s' },
  [NumericUnit.MegabitsSec]: { type: 'fixed', suffix: 'Mbit/s' },
  [NumericUnit.GibibytesSec]: { type: 'fixed', suffix: 'GiB/s' },
  [NumericUnit.GibibitsSec]: { type: 'fixed', suffix: 'Gibit/s' },
  [NumericUnit.GigabytesSec]: { type: 'fixed', suffix: 'GB/s' },
  [NumericUnit.GigabitsSec]: { type: 'fixed', suffix: 'Gbit/s' },
  [NumericUnit.TebibytesSec]: { type: 'fixed', suffix: 'TiB/s' },
  [NumericUnit.TebibitsSec]: { type: 'fixed', suffix: 'Tibit/s' },
  [NumericUnit.TerabytesSec]: { type: 'fixed', suffix: 'TB/s' },
  [NumericUnit.TerabitsSec]: { type: 'fixed', suffix: 'Tbit/s' },
  [NumericUnit.PebibytesSec]: { type: 'fixed', suffix: 'PiB/s' },
  [NumericUnit.PebibitsSec]: { type: 'fixed', suffix: 'Pibit/s' },
  [NumericUnit.PetabytesSec]: { type: 'fixed', suffix: 'PB/s' },
  [NumericUnit.PetabitsSec]: { type: 'fixed', suffix: 'Pbit/s' },
  // Throughput
  [NumericUnit.Cps]: { type: 'fixed', suffix: 'cps' },
  [NumericUnit.Ops]: { type: 'fixed', suffix: 'ops' },
  [NumericUnit.Rps]: { type: 'fixed', suffix: 'rps' },
  [NumericUnit.ReadsSec]: { type: 'fixed', suffix: 'rps' },
  [NumericUnit.Wps]: { type: 'fixed', suffix: 'wps' },
  [NumericUnit.Iops]: { type: 'fixed', suffix: 'iops' },
  [NumericUnit.Cpm]: { type: 'fixed', suffix: 'cpm' },
  [NumericUnit.Opm]: { type: 'fixed', suffix: 'opm' },
  [NumericUnit.RpmReads]: { type: 'fixed', suffix: 'rpm' },
  [NumericUnit.Wpm]: { type: 'fixed', suffix: 'wpm' },
};

const IEC_BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
const SI_BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
const IEC_BIT_UNITS = ['b', 'Kibit', 'Mibit', 'Gibit', 'Tibit', 'Pibit'];
const SI_BIT_UNITS = ['b', 'Kbit', 'Mbit', 'Gbit', 'Tbit', 'Pbit'];

const formatAutoScaleData = (
  value: number,
  base: 'iec' | 'si',
  isBits: boolean,
  perSec: boolean,
  mantissa: number,
): string => {
  const divisor = base === 'iec' ? 1024 : 1000;
  const units =
    base === 'iec'
      ? isBits
        ? IEC_BIT_UNITS
        : IEC_BYTE_UNITS
      : isBits
        ? SI_BIT_UNITS
        : SI_BYTE_UNITS;
  const rateSuffix = perSec ? '/s' : '';

  let absVal = Math.abs(value);
  let i = 0;
  while (absVal >= divisor && i < units.length - 1) {
    absVal /= divisor;
    i++;
  }
  const scaledValue = value < 0 ? -absVal : absVal;
  return `${scaledValue.toFixed(mantissa)} ${units[i]}${rateSuffix}`;
};

export const formatNumber = (
  value?: string | number,
  options?: NumberFormat,
): string => {
  if (!value && value !== 0) {
    return 'N/A';
  }

  // Guard against NaN only - ClickHouse can return numbers as strings, which
  // we should still format. Only truly non-numeric values (NaN) get passed through.
  if (typeof value !== 'number') {
    if (isNaN(Number(value))) {
      return String(value);
    }
    value = Number(value);
  }

  if (!options) {
    return value.toString();
  }

  const mantissa = options.mantissa ?? 0;

  // Handle new unit categories with numericUnit
  if (
    options.numericUnit &&
    (options.output === 'byte' ||
      options.output === 'data_rate' ||
      options.output === 'throughput')
  ) {
    const config = NUMERIC_UNIT_CONFIGS[options.numericUnit];
    if (config) {
      if (config.type === 'auto_scale') {
        return formatAutoScaleData(
          value,
          config.base,
          config.isBits,
          config.perSec,
          mantissa,
        );
      }
      return `${value.toFixed(mantissa)} ${config.suffix}`;
    }
  }

  // Handle data_rate / throughput without a numericUnit — fall through to number
  if (options.output === 'data_rate' || options.output === 'throughput') {
    return value.toFixed(mantissa);
  }

  if (options.output === 'duration') {
    const factor = options.factor ?? 1;
    const ms = value * factor * 1000;
    return formatDurationMs(ms);
  }

  const numbroFormat: numbro.Format = {
    output: options.output || 'number',
    mantissa: mantissa,
    thousandSeparated: options.thousandSeparated || false,
    average: options.average || false,
    ...(options.output === 'byte' && {
      base: options.decimalBytes ? 'decimal' : 'general',
      spaceSeparated: true,
      average: false,
    }),
    ...(options.output === 'currency' && {
      currencySymbol: options.currencySymbol || '$',
    }),
  };

  // Factor is only currently available for the time output
  const factor = options.output === 'time' ? (options.factor ?? 1) : 1;

  return (
    numbro(value * factor).format(numbroFormat) +
    (options.unit ? ` ${options.unit}` : '')
  );
};

/**
 * Formats a duration value given in milliseconds into a human-readable
 * adaptive string (e.g. "120.41s", "45ms", "3µs"). Mirrors the trace
 * waterfall rendering style.
 */
export function formatDurationMs(ms: number): string {
  if (ms < 0) {
    return `-${formatDurationMs(-ms)}`;
  }

  if (ms === 0) {
    return '0ms';
  }

  if (ms < 1) {
    const µs = ms * 1000;
    if (µs < 10) {
      return `${parseFloat(µs.toPrecision(2))}µs`;
    }
    const µsRounded = Math.round(µs);
    if (µsRounded < 1000) {
      return `${µsRounded}µs`;
    }
  }

  if (ms < 1000) {
    if (ms < 10) {
      return `${parseFloat(ms.toPrecision(3))}ms`;
    }
    return `${parseFloat(ms.toFixed(1))}ms`;
  }

  if (ms < 60_000) {
    return `${parseFloat((ms / 1000).toFixed(2))}s`;
  }

  if (ms < 3_600_000) {
    return `${parseFloat((ms / 60_000).toFixed(2))}min`;
  }

  return `${parseFloat((ms / 3_600_000).toFixed(2))}h`;
}

/** Compact duration labels for axis ticks — fewer decimals, shorter units. */
export function formatDurationMsCompact(ms: number): string {
  if (ms < 0) return `-${formatDurationMsCompact(-ms)}`;
  if (ms === 0) return '0';
  if (ms < 0.001) return `${+(ms * 1e6).toPrecision(2)}ns`;
  if (ms < 1) {
    const µs = ms * 1000;
    return µs < 10 ? `${+µs.toPrecision(2)}µs` : `${Math.round(µs)}µs`;
  }
  if (ms < 1000) {
    return ms < 10 ? `${+ms.toPrecision(2)}ms` : `${Math.round(ms)}ms`;
  }
  if (ms < 120_000) return `${+(ms / 1000).toPrecision(3)}s`;
  if (ms < 3_600_000) return `${+(ms / 60_000).toPrecision(2)}m`;
  return `${+(ms / 3_600_000).toPrecision(2)}h`;
}

// format uptime as days, hours, minutes or seconds
export const formatUptime = (seconds: number) => {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 60 * 60) {
    return `${Math.floor(seconds / 60)}m`;
  } else if (seconds < 60 * 60 * 24) {
    return `${Math.floor(seconds / 60 / 60)}h`;
  } else {
    return `${Math.floor(seconds / 60 / 60 / 24)}d`;
  }
};

// FIXME: eventually we want to separate metric name into two fields
// Date formatting
export const mergePath = (path: string[], jsonColumns: string[] = []) => {
  const [key, ...rest] = path;
  if (rest.length === 0) {
    return key;
  }
  return jsonColumns.includes(key)
    ? `${key}.${rest
        .map(v =>
          v
            .split('.')
            .map(v => (v.startsWith('`') && v.endsWith('`') ? v : `\`${v}\``))
            .join('.'),
        )
        .join('.')}`
    : `${key}${rest
        .map(v => {
          const asNumber = Number(v);
          const isArrayIndex = Number.isInteger(asNumber) && asNumber >= 0;
          // ClickHouse arrays are 1-based, but flattened data uses 0-based indices
          return isArrayIndex ? `[${asNumber + 1}]` : `['${v}']`;
        })
        .join('')}`;
};

const _useTry = <T>(fn: () => T): [null | Error | unknown, null | T] => {
  let output = null;
  let error = null;
  try {
    output = fn();
    return [error, output];
  } catch (e) {
    error = e;
    return [error, output];
  }
};

export const parseJSON = <T = any>(json: string) => {
  const [_error, result] = _useTry<T>(() => JSON.parse(json));
  return result;
};

export const optionsToSelectData = (options: Record<string, string>) =>
  Object.entries(options).map(([value, label]) => ({ value, label }));

// Helper function to format attribute clause
export function formatAttributeClause(
  column: string,
  field: string,
  value: string,
  isSql: boolean,
): string {
  return isSql
    ? `${column}['${field}']='${value}'`
    : `${column}.${field}:"${value}"`;
}

/**
 * Gets the appropriate table name for a source based on metric type
 * @param source The data source
 * @param metricType Optional metric type to determine which table to use
 * @returns The table name to use for the given source and metric type
 */
export function getMetricTableName(
  source: TSource,
  metricType?: string,
): string | undefined {
  if (metricType == null) {
    return source.from.tableName;
  }
  if (source.kind === SourceKind.Metric) {
    return source.metricTables?.[
      metricType.toLowerCase() as keyof typeof source.metricTables
    ];
  }
  return undefined;
}

export function getAllMetricTables(source: TSource): TableConnection[] {
  if (source.kind !== SourceKind.Metric || !source.metricTables) return [];

  return Object.values(MetricsDataType)
    .filter(
      metricType =>
        !!source.metricTables[
          metricType as unknown as keyof TMetricSource['metricTables']
        ],
    )
    .map(
      metricType =>
        ({
          tableName:
            source.metricTables[
              metricType as unknown as keyof TMetricSource['metricTables']
            ],
          databaseName: source.from.databaseName,
          connectionId: source.connection,
        }) satisfies TableConnection,
    );
}

/**
 * Converts (T | T[]) to T[]. If undefined, empty array
 */
export function toArray<T>(obj?: T | T[]): T[] {
  return !obj ? [] : Array.isArray(obj) ? obj : [obj];
}

// Helper function to remove trailing slash
export const stripTrailingSlash = (url: string | undefined | null): string => {
  if (!url || typeof url !== 'string') {
    throw new Error('URL must be a non-empty string');
  }
  return url.endsWith('/') ? url.slice(0, -1) : url;
};

/**
 * Converts the given SortingState into a SQL Order By string
 * Note, only the first element of the SortingState is used. Returns
 * undefined if the input is null or empty.
 *
 * Output format: "<column> <ASC|DESC>"
 * */
export const sortingStateToOrderByString = (
  sort: SortingState | null,
): string | undefined => {
  const firstSort = sort?.at(0);
  return firstSort
    ? `${firstSort.id} ${firstSort.desc ? 'DESC' : 'ASC'}`
    : undefined;
};

/**
 * Converts the given SQL Order By string into a SortingState.
 *
 * Expects format matching the output of sortingStateToOrderByString
 * ("<column> <ASC|DESC>"). Returns undefined if the input is invalid.
 */
export const orderByStringToSortingState = (
  orderBy: string | undefined,
): SortingState | undefined => {
  if (!orderBy) {
    return undefined;
  }

  const orderByParts = orderBy.split(' ');
  const endsWithDirection = orderBy.toLowerCase().match(/ (asc|desc)$/i);

  if (orderByParts.length !== 2 || !endsWithDirection) {
    return undefined;
  }

  return [
    {
      id: orderByParts[0].trim(),
      desc: orderByParts[1].trim().toUpperCase() === 'DESC',
    },
  ];
};

export const mapKeyBy = <T>(array: T[], key: keyof T) => {
  const map = new Map<T[typeof key], T>();

  for (const item of array) {
    map.set(item[key], item);
  }

  return map;
};

/**
 * Check if an element is clickable, or if it is obscured by a modal or drawer
 *
 * @param el - The element to check if it is clickable
 * @returns True if the element is clickable, false otherwise
 */
export const isElementClickable = (el: HTMLElement): boolean => {
  if (!el) return false;

  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const elementAtPoint = document.elementFromPoint(x, y);
  // return true if the element at point is the same as the element passed in
  // or if the element at point is a descendant of the element passed in
  return el === elementAtPoint || el.contains(elementAtPoint);
};

export function parseTimestampToMs(isoString: string): number {
  const ts = TimestampNano.fromString(isoString);
  return ts.toDate().getTime() + (ts.getNano() % 1_000_000) / 1_000_000;
}
