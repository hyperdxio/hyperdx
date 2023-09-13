import { format as fnsFormat, formatDistanceToNowStrict } from 'date-fns';
import { useRouter } from 'next/router';
import { useState, useEffect, useRef } from 'react';
import Convert from 'ansi-to-html';

import type { MutableRefObject } from 'react';

import { dateRangeToString } from './timeQuery';

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
export const useDebounce = <T,>(
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

export function useLocalStorage<T>(key: string, initialValue: T) {
  // State to store our value
  // Pass initial state function to useState so logic is only executed once
  const [storedValue, setStoredValue] = useState<T>(initialValue);

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
      console.log(error);
    }
  }, [key]);

  // Return a wrapped version of useState's setter function that ...
  // ... persists the new value to localStorage.
  const setValue = (value: T | Function) => {
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
    } catch (error) {
      // A more advanced implementation would handle the error case
      console.log(error);
    }
  };
  return [storedValue, setValue] as const;
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

export function formatHumanReadableDate(date: Date) {
  return fnsFormat(date, 'MMMM d, h:mmaaa');
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
      level.startsWith('trace')
    ? 'info'
    : undefined;
};

const COLORS = [
  '#d5dade', // White
  '#20c997', // Green
  '#0dcaf0', // Turqoise
  '#8250dc', // Light Purple
  '#cdad7a', // Tan
  '#6610f2', // Purple
  '#0d6efd', // Blue
  '#fd7e14', // Orange
  '#828c95', // Grey
  '#ff9382', // Coral
  '#39b5ab', // Olive-tealish?
  '#ffa600', // Yellow
  // '#d63384', // Magenta, too close to red
];
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

const keyedColor = (key: string | number | undefined) => {
  const num = Math.floor(Math.abs(hashCode(`${key}` ?? '')));
  return COLORS[num % COLORS.length];
};

// Try to match log levels to colors
export const semanticKeyedColor = (key: string | number | undefined) => {
  const logLevel = getLogLevelClass(`${key}`);
  if (logLevel != null) {
    return logLevel === 'error'
      ? '#d63384' // magenta
      : logLevel === 'warn'
      ? '#ffc107' // yellow
      : '#20c997'; // green;
  }

  return keyedColor(key);
};

export const truncateMiddle = (str: string, maxLen = 10) => {
  if (str.length <= maxLen) {
    return str;
  }
  return `${str.slice(0, (maxLen - 2) / 2)}..${str.slice(
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

export const usePrevious = <T,>(value: T): T | undefined => {
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
