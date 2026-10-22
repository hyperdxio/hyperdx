import {
  BrowserEventKind,
  CONSOLE_METHOD_ATTRIBUTE,
  firstLine,
  getElementAttributes,
} from '@/utils/browserEvents';
import {
  Attributes,
  firstSetString,
  isSet,
} from '@/utils/spanAttributeReaders';

import { RequestDetailRow, RequestDetailsTable } from './RequestDetailsTable';

const PAGE_URL_KEY = 'browser.document.url.full';

function read(attributes: Attributes, key: string): string | undefined {
  return firstSetString(attributes, [key]);
}

// Map columns hold the flag as 'true'/'false', JSON columns as a Bool.
function yesNo(value: unknown): string | undefined {
  if (!isSet(value)) {
    return undefined;
  }
  return String(value) === 'true' ? 'Yes' : 'No';
}

function getClickRows(attributes: Attributes): RequestDetailRow[] {
  return [
    ['Element', read(attributes, 'browser.tag_name')?.toLowerCase()],
    ['CSS selector', read(attributes, 'browser.css_selector')],
    ...getElementAttributes(attributes).map(
      ([name, value]): RequestDetailRow => [`data-otel-${name}`, value],
    ),
    ['Page URL', read(attributes, PAGE_URL_KEY)],
  ];
}

function getNavigationRows(attributes: Attributes): RequestDetailRow[] {
  return [
    ['URL', read(attributes, 'url.full')],
    ['Navigation type', read(attributes, 'browser.navigation.type')],
    ['Same document', yesNo(attributes['browser.navigation.same_document'])],
    ['Hash change', yesNo(attributes['browser.navigation.hash_change'])],
  ];
}

function getConsoleRows(
  attributes: Attributes,
  body: string | undefined,
): RequestDetailRow[] {
  return [
    ['Method', read(attributes, CONSOLE_METHOD_ATTRIBUTE)],
    // The SDK sends the console message as the body, never as an attribute.
    ['Message', body ? firstLine(body) : undefined],
    ['Page URL', read(attributes, PAGE_URL_KEY)],
  ];
}

export function BrowserEventSubpanel({
  kind,
  attributes,
  body,
}: {
  kind: BrowserEventKind;
  /** The row's flattened event attributes. */
  attributes: Attributes;
  body: string | undefined;
}) {
  const rows =
    kind === 'click'
      ? getClickRows(attributes)
      : kind === 'navigation'
        ? getNavigationRows(attributes)
        : getConsoleRows(attributes, body);
  return <RequestDetailsTable rows={rows} />;
}
