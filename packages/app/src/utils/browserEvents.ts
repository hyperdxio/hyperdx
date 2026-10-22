import { flatten } from 'flat';
import { parseJSON } from '@hyperdx/common-utils/dist/core/utils';

import { isRecord } from '@/llm/lib/attributeUtils';
import { getShortUrl } from '@/utils';
import {
  Attributes,
  firstSetString,
  isSet,
} from '@/utils/spanAttributeReaders';

// Event names from upstream's experimental @opentelemetry/browser-instrumentation.
// Browser semconv is still in Development, so they live in one place.
export const BROWSER_EVENT_NAMES = {
  CLICK: 'browser.user_action.click',
  NAVIGATION: 'browser.navigation',
  CONSOLE: 'browser.console',
  EXCEPTION: 'exception',
} as const;

export const CONSOLE_METHOD_ATTRIBUTE = 'browser.console.method';

const ELEMENT_ATTRIBUTES_KEY = 'browser.element.attributes';
const SHORT_SELECTOR_SEGMENTS = 3;

export type BrowserEventLabel = {
  title: string;
  description: string;
  /** Tooltip text for the timeline marker. */
  timelineText: string;
  isError: boolean;
  /** Picks the event list icon. */
  eventSource: 'navigation' | 'custom' | 'log';
};

function joinWords(...words: Array<string | undefined>): string {
  return words.filter(Boolean).join(' ');
}

export function firstLine(text: string): string {
  return text.split('\n', 1)[0].trim();
}

function setPairs(entries: [string, unknown][]): [string, string][] {
  return entries
    .filter(([, value]) => isSet(value))
    .map(([key, value]) => [key, String(value)]);
}

// The SDK sends data-otel-* attributes, prefix removed, as one map. The
// collector flattens it into `browser.element.attributes.<name>` keys; without
// that step a Map column holds it as a JSON string.
export function getElementAttributes(
  attributes: Attributes,
): [string, string][] {
  const prefix = `${ELEMENT_ATTRIBUTES_KEY}.`;
  const flatPairs = setPairs(
    Object.entries(attributes)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key.slice(prefix.length), value]),
  );
  if (flatPairs.length > 0) {
    return flatPairs;
  }
  const raw = attributes[ELEMENT_ATTRIBUTES_KEY];
  const parsed = typeof raw === 'string' ? parseJSON<unknown>(raw) : undefined;
  return isRecord(parsed) ? setPairs(Object.entries(parsed)) : [];
}

// Upstream's getElementCSSSelector joins segments with ' > '. A segment is a
// unique `#id`, where the selector then starts, or the tag followed by every
// class name and `:nth-child(n)` when siblings share them. Class names can be
// hundreds of characters long (utility CSS), so the label drops them and keeps
// the tail, which names the element.
function getShortSelector(selector: string): string {
  const segments = selector.split(' > ').slice(-SHORT_SELECTOR_SEGMENTS);
  const idIndex = segments.findLastIndex(segment => segment.startsWith('#'));
  return segments
    .slice(Math.max(idIndex, 0))
    .map(segment => {
      if (segment.startsWith('#')) {
        return segment;
      }
      const nthChild = segment.match(/:nth-child\(\d+\)$/)?.[0] ?? '';
      const tagAndClasses = segment.slice(0, segment.length - nthChild.length);
      return `${tagAndClasses.split('.', 1)[0]}${nthChild}`;
    })
    .join(' > ');
}

function getClickLabel(attributes: Attributes): BrowserEventLabel {
  const tag = firstSetString(attributes, ['browser.tag_name'])?.toLowerCase();
  const selector = firstSetString(attributes, ['browser.css_selector']);
  const description =
    getElementAttributes(attributes)
      .map(([name, value]) => `${name}=${value}`)
      .join(' ') || (selector ? getShortSelector(selector) : '');
  return {
    title: joinWords('Clicked', tag),
    description,
    timelineText: joinWords('Clicked', description || tag),
    isError: false,
    eventSource: 'custom',
  };
}

function getNavigationLabel(attributes: Attributes): BrowserEventLabel {
  const url = firstSetString(attributes, [
    'url.full',
    'browser.document.url.full',
  ]);
  const shortUrl = url != null ? getShortUrl(url) : '';
  return {
    title: 'Navigated',
    description: shortUrl,
    timelineText: joinWords('Navigated to', shortUrl),
    isError: false,
    eventSource: 'navigation',
  };
}

function getConsoleLabel(
  attributes: Attributes,
  body: string,
): BrowserEventLabel {
  const method = firstSetString(attributes, [CONSOLE_METHOD_ATTRIBUTE]);
  const title = method != null ? `console.${method}` : 'console';
  const line = firstLine(body);
  return {
    title,
    description: line,
    timelineText: line ? `${title}: ${line}` : title,
    isError: method === 'error',
    eventSource: 'log',
  };
}

function getExceptionLabel(
  attributes: Attributes,
  body: string,
): BrowserEventLabel {
  const type = firstSetString(attributes, ['exception.type']);
  // Without a message attribute the body reads like `Error: <message>`.
  const message = firstLine(
    firstSetString(attributes, ['exception.message']) ?? body,
  );
  return {
    title: type ?? 'Error',
    description: message,
    timelineText:
      type != null && message ? `${type}: ${message}` : message || 'Error',
    isError: true,
    eventSource: 'log',
  };
}

function toAttributes(attributes: unknown): Attributes {
  return isRecord(attributes)
    ? flatten<Attributes, Attributes>(attributes)
    : {};
}

export function getBrowserEventLabel({
  eventName,
  body,
  attributes,
}: {
  eventName: string;
  body: unknown;
  /** Flat keys from a Map column or nested objects from a JSON column. */
  attributes: unknown;
}): BrowserEventLabel {
  const flat = toAttributes(attributes);
  const text = typeof body === 'string' ? body : '';
  switch (eventName) {
    case BROWSER_EVENT_NAMES.CLICK:
      return getClickLabel(flat);
    case BROWSER_EVENT_NAMES.NAVIGATION:
      return getNavigationLabel(flat);
    case BROWSER_EVENT_NAMES.CONSOLE:
      return getConsoleLabel(flat, text);
    case BROWSER_EVENT_NAMES.EXCEPTION:
      return getExceptionLabel(flat, text);
    default:
      return {
        title: eventName,
        description: firstLine(text),
        timelineText: eventName,
        isError: false,
        eventSource: 'log',
      };
  }
}

export type BrowserEventKind = 'click' | 'navigation' | 'console';

type BrowserEventRow = {
  eventName: unknown;
  /** Flat keys from a Map column or nested objects from a JSON column. */
  attributes: unknown;
};

const KIND_BY_EVENT_NAME = new Map<string, BrowserEventKind>([
  [BROWSER_EVENT_NAMES.CLICK, 'click'],
  [BROWSER_EVENT_NAMES.NAVIGATION, 'navigation'],
  [BROWSER_EVENT_NAMES.CONSOLE, 'console'],
]);

// A row has no event name when its source predates the Event Name Expression
// field, or when its table (or Known Columns List) has no such column. The SDK
// always sends these keys with their kind, and only with it.
const KIND_ATTRIBUTE_KEYS: [BrowserEventKind, string[]][] = [
  ['click', ['browser.tag_name', 'browser.css_selector']],
  [
    'navigation',
    [
      'browser.navigation.same_document',
      'browser.navigation.hash_change',
      'browser.navigation.type',
    ],
  ],
  ['console', [CONSOLE_METHOD_ATTRIBUTE]],
];

export function getBrowserEventKind({
  eventName,
  attributes,
}: BrowserEventRow): BrowserEventKind | undefined {
  if (isSet(eventName)) {
    return KIND_BY_EVENT_NAME.get(String(eventName));
  }
  const flat = toAttributes(attributes);
  return KIND_ATTRIBUTE_KEYS.find(([, keys]) =>
    keys.some(key => isSet(flat[key])),
  )?.[0];
}

export function isBrowserEventRow(row: BrowserEventRow): boolean {
  return isSet(row.eventName)
    ? String(row.eventName).startsWith('browser.')
    : getBrowserEventKind(row) != null;
}
