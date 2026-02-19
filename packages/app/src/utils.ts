import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { formatDistanceToNowStrict } from 'date-fns';
import numbro from 'numbro';
import type { MutableRefObject, SetStateAction } from 'react';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { SortingState } from '@tanstack/react-table';

import { dateRangeToString } from './timeQuery';
import { MetricsDataType, NumberFormat } from './types';

export function omit<T extends object, K extends keyof T>(
  obj: T,
  paths: K[],
): Omit<T, K> {
  return {
    ...paths.reduce(
      (mem, key) => ((k: K, { [k]: ignored, ...rest }) => rest)(key, mem),
      obj as object,
    ),
  } as Omit<T, K>;
}

export function generateSearchUrl({
  query,
  dateRange,
  lineId,
  isUTC,
  savedSearchId,
}: {
  savedSearchId?: string;
  query?: string;
  dateRange?: [Date, Date];
  lineId?: string;
  isUTC?: boolean;
}) {
  const fromDate = dateRange ? dateRange[0] : new Date();
  const toDate = dateRange ? dateRange[1] : new Date();
  const qparams = new URLSearchParams({
    q: query ?? '',
    from: fromDate.getTime().toString(),
    to: toDate.getTime().toString(),
    tq: dateRangeToString([fromDate, toDate], isUTC ?? false),
    ...(lineId ? { lid: lineId } : {}),
  });
  return `/search${
    savedSearchId != null ? `/${savedSearchId}` : ''
  }?${qparams.toString()}`;
}

export function useFirstNonNullValue<T>(value: T): T {
  const [firstNonNullValue, setFirstNonNullValue] = useState<T>(value);
  useEffect(() => {
    if (value != null) {
      setFirstNonNullValue(v => (v == null ? value : v));
    }
  }, [value]);
  return firstNonNullValue;
}

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
  } catch (err) {
    return false;
  }
};

export const isValidJson = (input: string) => {
  try {
    JSON.parse(input);
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
  } catch (e) {
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

export function getLocalStorageValue<T>(key: string): T | null {
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

export function useQueryHistory<T>(type: string | undefined) {
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

// Chart color palette - single source of truth
// Colors from Observable categorical palette, with custom brand green
// https://observablehq.com/@d3/color-schemes
export const CHART_PALETTE = {
  green: '#00c28a', // Brand green (Mantine green.5) - used as primary chart color
  blue: '#4269d0',
  orange: '#efb118',
  red: '#ff725c',
  cyan: '#6cc5b0',
  pink: '#ff8ab7',
  purple: '#a463f2',
  lightBlue: '#97bbf5',
  brown: '#9c6b4e',
  gray: '#9498a0',
  // Highlighted variants (lighter shades for hover/selection states)
  redHighlight: '#ffa090',
  orangeHighlight: '#f5c94d',
} as const;

// ClickStack theme chart color palette - Observable 10 categorical palette
// https://observablehq.com/@d3/color-schemes
export const CLICKSTACK_CHART_PALETTE = {
  blue: '#437EEF', // Primary color for ClickStack
  orange: '#efb118',
  red: '#ff725c',
  cyan: '#6cc5b0',
  green: '#3ca951',
  pink: '#ff8ab7',
  purple: '#a463f2',
  lightBlue: '#97bbf5',
  brown: '#9c6b4e',
  gray: '#9498a0',
  // Highlighted variants (lighter shades for hover/selection states)
  redHighlight: '#ffa090',
  orangeHighlight: '#f5c94d',
} as const;

// Ordered array for chart series - green first for brand consistency (HyperDX default)
// Maps to CSS variables: COLORS[0] -> --color-chart-1, COLORS[1] -> --color-chart-2, etc.
// NOTE: This is a fallback for SSR. In browser, getColorFromCSSVariable() reads from CSS variables
export const COLORS = [
  CHART_PALETTE.green, // 1 - Brand green (primary) - HyperDX default
  CHART_PALETTE.blue, // 2
  CHART_PALETTE.orange, // 3
  CHART_PALETTE.red, // 4
  CHART_PALETTE.cyan, // 5
  CHART_PALETTE.pink, // 6
  CHART_PALETTE.purple, // 7
  CHART_PALETTE.lightBlue, // 8
  CHART_PALETTE.brown, // 9
  CHART_PALETTE.gray, // 10
];

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
 * Reads chart color from CSS variable based on index.
 * CSS variables handle theme switching automatically via theme classes on documentElement.
 * Falls back to COLORS array if CSS variable is not available (SSR or getComputedStyle fails).
 *
 * Note on SSR/Hydration: During SSR, this returns fallback colors (HyperDX green palette).
 * On client hydration, it reads from CSS variables which may differ for ClickStack theme.
 * This is expected behavior - charts typically render after data fetching (client-side),
 * so hydration mismatches are rare. If needed, wrap chart components with suppressHydrationWarning.
 */
export function getColorFromCSSVariable(index: number): string {
  const colorArrayLength = COLORS.length;

  if (typeof window === 'undefined') {
    // SSR: fallback to default colors (HyperDX palette)
    return COLORS[index % colorArrayLength];
  }

  try {
    const cssVarName = `--color-chart-${(index % colorArrayLength) + 1}`;
    // Read from documentElement - CSS variables cascade from theme classes
    const computedStyle = getComputedStyle(document.documentElement);
    const color = computedStyle.getPropertyValue(cssVarName).trim();

    // Only use CSS variable if it's actually set (non-empty)
    if (color && color !== '') {
      return color;
    }
  } catch {
    // Fallback if getComputedStyle fails
  }

  // Fallback to default colors
  return COLORS[index % colorArrayLength];
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
 * Gets theme-aware chart color from CSS variable or falls back to palette.
 * Reads from --color-chart-{type} CSS variable, falls back to theme-appropriate palette.
 *
 * Note on SSR/Hydration: During SSR, returns HyperDX colors as default.
 * On client, reads from CSS variables for accurate theme colors.
 * Charts typically render client-side after data fetching, minimizing hydration issues.
 */
function getSemanticChartColor(
  cssVarName: string,
  hyperdxColor: string,
  clickstackColor: string,
): string {
  if (typeof window === 'undefined') {
    // SSR: use HyperDX as default (can't detect theme without DOM)
    return hyperdxColor;
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

  // Fallback to theme-appropriate palette
  const activeTheme = detectActiveTheme();
  return activeTheme === 'clickstack' ? clickstackColor : hyperdxColor;
}

// Semantic colors for log levels (theme-aware)
// These are functions that read from CSS variables with theme-appropriate fallbacks
export function getChartColorSuccess(): string {
  return getSemanticChartColor(
    '--color-chart-success',
    CHART_PALETTE.green,
    CLICKSTACK_CHART_PALETTE.green,
  );
}

export function getChartColorWarning(): string {
  return getSemanticChartColor(
    '--color-chart-warning',
    CHART_PALETTE.orange,
    CLICKSTACK_CHART_PALETTE.orange,
  );
}

export function getChartColorError(): string {
  return getSemanticChartColor(
    '--color-chart-error',
    CHART_PALETTE.red,
    CLICKSTACK_CHART_PALETTE.red,
  );
}

// Highlighted variants (theme-aware)
export function getChartColorErrorHighlight(): string {
  return getSemanticChartColor(
    '--color-chart-error-highlight',
    CHART_PALETTE.redHighlight,
    CLICKSTACK_CHART_PALETTE.redHighlight,
  );
}

export function getChartColorWarningHighlight(): string {
  return getSemanticChartColor(
    '--color-chart-warning-highlight',
    CHART_PALETTE.orangeHighlight,
    CLICKSTACK_CHART_PALETTE.orangeHighlight,
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
        : // Info-level logs use primary chart color (blue for ClickStack, green for HyperDX)
          getColorFromCSSVariable(0);
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
      : // Info-level logs use primary chart color (blue for ClickStack, green for HyperDX)
        getColorFromCSSVariable(0);
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
      : // Info-level logs use primary chart color (blue for ClickStack, green for HyperDX)
        getColorFromCSSVariable(0);
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

export const useIsBlog = () => {
  const router = useRouter();
  return router?.pathname.startsWith('/blog');
};

export const useIsDocs = () => {
  const router = useRouter();
  return router?.pathname.startsWith('/docs');
};

export const useIsTerms = () => {
  const router = useRouter();
  return router?.pathname.startsWith('/terms');
};

export const usePrevious = <T>(value: T): T | undefined => {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  });
  // eslint-disable-next-line react-hooks/refs
  return ref.current;
};

// From https://javascript.plainenglish.io/how-to-make-a-simple-custom-usedrag-react-hook-6b606d45d353
export const useDrag = (
  ref: MutableRefObject<HTMLDivElement | null>,
  options: {
    onDrag?: (e: PointerEvent) => any;
    onPointerDown?: (e: PointerEvent) => any;
    onPointerUp?: (e: PointerEvent) => any;
    onPointerMove?: (e: PointerEvent) => any;
  },
) => {
  const {
    onPointerDown = () => {},
    onPointerUp = () => {},
    onPointerMove = () => {},
    onDrag = () => {},
  } = options;

  const [isDragging, setIsDragging] = useState(false);

  const handlePointerDown = (e: PointerEvent) => {
    setIsDragging(true);

    onPointerDown(e);
  };

  const handlePointerUp = (e: PointerEvent) => {
    setIsDragging(false);

    onPointerUp(e);
  };

  const handlePointerMove = (e: PointerEvent) => {
    onPointerMove(e);

    if (isDragging) {
      onDrag(e);
    }
  };

  useEffect(() => {
    const element = ref.current;
    if (element) {
      element.addEventListener('pointerdown', handlePointerDown);
      element.addEventListener('pointerup', handlePointerUp);
      element.addEventListener('pointermove', handlePointerMove);

      return () => {
        element.removeEventListener('pointerdown', handlePointerDown);
        element.removeEventListener('pointerup', handlePointerUp);
        element.removeEventListener('pointermove', handlePointerMove);
      };
    }
    // disable dependency array as this doesn't fit nicely with react
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isDragging };
};

export const formatNumber = (
  value?: number,
  options?: NumberFormat,
): string => {
  if (!value && value !== 0) {
    return 'N/A';
  }

  if (!options) {
    return value.toString();
  }

  const numbroFormat: numbro.Format = {
    output: options.output || 'number',
    mantissa: options.mantissa || 0,
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
export const legacyMetricNameToNameAndDataType = (metricName?: string) => {
  const [mName, mDataType] = (metricName ?? '').split(' - ');

  return {
    name: mName,
    dataType: mDataType as MetricsDataType,
  };
};

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
    : `${key}['${rest.join("']['")}']`;
};

export const _useTry = <T>(fn: () => T): [null | Error | unknown, null | T] => {
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
  const [error, result] = _useTry<T>(() => JSON.parse(json));
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
  return metricType == null
    ? source.from.tableName
    : source.metricTables?.[
        metricType.toLowerCase() as keyof typeof source.metricTables
      ];
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
