import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useMemo,
} from 'react';
import { parseAsString, useQueryState } from 'nuqs';

import { isTimeZonePreference } from './timeZone';

type TimeZoneOverride = {
  /** The page's time zone setting, or null to use the user's. */
  timeZone: string | null;
  setTimeZone: (timeZone: string | null) => void;
};

const TimeZoneOverrideContext = createContext<TimeZoneOverride | null>(null);

/**
 * Lets a page show times in its own zone, kept in the `tz` URL param so links
 * keep it. Wrap the page's content, not the app: the sidebar keeps showing
 * the user's setting.
 */
export function TimeZoneOverrideProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [tz, setTz] = useQueryState('tz', parseAsString);

  const timeZone = tz != null && isTimeZonePreference(tz) ? tz : null;

  const value = useMemo<TimeZoneOverride>(
    () => ({ timeZone, setTimeZone: setTz }),
    [timeZone, setTz],
  );

  return (
    <TimeZoneOverrideContext value={value}>{children}</TimeZoneOverrideContext>
  );
}

/** The page's time zone override, or null outside `TimeZoneOverrideProvider`. */
export function useTimeZoneOverride(): TimeZoneOverride | null {
  return use(TimeZoneOverrideContext);
}

/**
 * Adds `tz` to an in-app URL. Appends rather than re-encoding the query, whose
 * params can carry their own encoding (see buildEventsSearchUrl).
 */
export function withTimeZoneParam(
  url: string,
  timeZone: string | null | undefined,
): string {
  if (timeZone == null) {
    return url;
  }
  const [path, hash] = url.split('#', 2);
  const separator = path.includes('?') ? '&' : '?';
  const withParam = `${path}${separator}tz=${encodeURIComponent(timeZone)}`;
  return hash == null ? withParam : `${withParam}#${hash}`;
}

/**
 * Adds the page's time zone override to links to pages that support one, so
 * they open in the same zone.
 */
export function useTimeZoneLinkParam(): (url: string) => string {
  const timeZone = useTimeZoneOverride()?.timeZone;
  return useCallback(url => withTimeZoneParam(url, timeZone), [timeZone]);
}
