import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { format as fnsFormat, formatDistanceToNowStrict } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import numbro from 'numbro';
import type { MutableRefObject } from 'react';
import { TSource } from '@hyperdx/common-utils/dist/types';

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
        event instanceof CustomEvent<CustomStorageChangeDetail> &&
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
  }, []);

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
  const setValue = (value: T | ((prevState: T) => T)) => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      // Allow value to be a function so we have same API as useState
      const valueToStore =
        value instanceof Function ? value(storedValue) : value;
      // Save state
      setStoredValue(valueToStore);
      // Save to local storage
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
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
  };
  return [storedValue, setValue] as const;
}

export function useIntersectionObserver(onIntersect: () => void) {
  const observer = useRef<IntersectionObserver | null>(null);
  const observerRef = useCallback((node: Element | null) => {
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        onIntersect();
      }
    });
    if (node) observer.current.observe(node);
  }, []);

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

// Accessible chart colors
export const COLORS = [
  '#20c997', // Green
  // '#F81358', // Red
  '#8250dc', // Light Purple
  '#cdad7a', // Tan
  '#0d6efd', // Blue
  '#fd7e14', // Orange
  '#0dcaf0', // Turqoise
  '#828c95', // Grey
  '#ff9382', // Coral
  '#39b5ab', // Olive-tealish?
  '#ffa600', // Yellow
];

const STROKE_DASHARRAYS = ['0', '4 3', '5 5'];

const STROKE_WIDTHS = [1.25];

const STROKE_OPACITIES = [1];

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

// Try to match log levels to colors
export const semanticKeyedColor = (
  key: string | number | undefined,
  index: number,
) => {
  const logLevel = getLogLevelClass(`${key}`);
  if (logLevel != null) {
    return logLevel === 'error'
      ? '#d63384' // magenta
      : logLevel === 'warn'
        ? '#ffc107' // yellow
        : '#20c997'; // green;
  }

  return COLORS[index % COLORS.length];
};

export const logLevelColor = (key: string | number | undefined) => {
  const logLevel = getLogLevelClass(`${key}`);
  return logLevel === 'error'
    ? '#F81358' // red
    : logLevel === 'warn'
      ? '#ffc107' // yellow
      : '#20c997'; // green;
};

// order of colors for sorting. green on bottom, then yellow, then red
export const logLevelColorOrder = [
  logLevelColor('info'),
  logLevelColor('warn'),
  logLevelColor('error'),
];

const getLevelColor = (logLevel?: string) => {
  if (logLevel == null) {
    return;
  }
  return logLevel === 'error'
    ? '#d63384' // magenta
    : logLevel === 'warn'
      ? '#ffc107' // yellow
      : '#20c997'; // green;
};

export const getColorProps = (
  index: number,
  level: string,
): {
  color: string;
  strokeDasharray: string;
  opacity: number;
  strokeWidth: number;
} => {
  const logLevel = getLogLevelClass(level);
  const colorOverride = getLevelColor(logLevel);

  // How many same colored lines we already have
  const colorStep = Math.floor(index / COLORS.length);

  return {
    color: colorOverride ?? COLORS[index % COLORS.length],
    strokeDasharray:
      STROKE_DASHARRAYS[Math.min(STROKE_DASHARRAYS.length, colorStep)],
    opacity: STROKE_OPACITIES[Math.min(STROKE_OPACITIES.length, colorStep)],
    strokeWidth: STROKE_WIDTHS[Math.min(STROKE_WIDTHS.length, colorStep)],
  };
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
  const ref = useRef<T>();
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
};

// From https://javascript.plainenglish.io/how-to-make-a-simple-custom-usedrag-react-hook-6b606d45d353
export const useDrag = (
  ref: MutableRefObject<HTMLDivElement | null>,
  deps = [],
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

    return () => {};
  }, [...deps, isDragging]);

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
  return (
    numbro(value * (options.factor ?? 1)).format(numbroFormat) +
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
const TIME_TOKENS = {
  normal: {
    '12h': 'MMM d h:mm:ss a',
    '24h': 'MMM d HH:mm:ss',
  },
  short: {
    '12h': 'MMM d h:mma',
    '24h': 'MMM d HH:mm',
  },
  withMs: {
    '12h': 'MMM d h:mm:ss.SSS a',
    '24h': 'MMM d HH:mm:ss.SSS',
  },
  time: {
    '12h': 'h:mm:ss a',
    '24h': 'HH:mm:ss',
  },
};

export const formatDate = (
  date: Date,
  {
    isUTC = false,
    format = 'normal',
    clock = '12h',
  }: {
    isUTC?: boolean;
    format?: 'normal' | 'short' | 'withMs' | 'time';
    clock?: '12h' | '24h';
  },
) => {
  const formatStr = TIME_TOKENS[format][clock];

  return isUTC
    ? formatInTimeZone(date, 'Etc/UTC', formatStr)
    : fnsFormat(date, formatStr);
};

export const mergePath = (path: string[]) => {
  const [key, ...rest] = path;
  if (rest.length === 0) {
    return key;
  }
  return `${key}['${rest.join("']['")}']`;
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
