import React from 'react';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

import { RowOverviewPanel } from '@/components/DBRowOverviewPanel';

let mockRow: Record<string, unknown>;
jest.mock('../DBRowDataPanel', () => ({
  useRowData: () => ({ data: { data: [mockRow] } }),
  getJSONColumnNames: () => [],
  getMapColumnNames: () => [],
}));

const mockExceptionSubpanel = jest.fn();
jest.mock('../ExceptionSubpanel', () => ({
  ExceptionSubpanel: (props: unknown) => mockExceptionSubpanel(props),
}));

jest.mock('../DBRowJsonViewer', () => ({ DBRowJsonViewer: () => null }));

jest.mock('../linkedSpans', () => ({
  useReverseSpanLinks: () => ({ links: [] }),
  useLinkedSpanDetails: () => ({ details: new Map() }),
}));

// `any`, not `as`, keeps this partial fixture off the lint warning budget.
const asSource = (value: any): TSource => value;
const LOG_SOURCE = asSource({
  kind: SourceKind.Log,
  eventAttributesExpression: 'LogAttributes',
});

function renderRow(row: Record<string, unknown>) {
  mockRow = row;
  renderWithMantine(<RowOverviewPanel source={LOG_SOURCE} rowId="row-1" />);
}

const exceptionValuesShown = () =>
  mockExceptionSubpanel.mock.calls[0]?.[0].exceptionValues;
const exceptionShown = () => exceptionValuesShown()[0];

const CHROME_STACK = [
  'Error: Checkout failed',
  '    at checkout (https://example.clickhouse.com/assets/app.js:120:11)',
  'Caused by: TypeError: Failed to fetch',
  '    at fetchCart (https://example.clickhouse.com/assets/app.js:42:9)',
].join('\n');

const JAVA_STACK = [
  'java.lang.IllegalStateException: Checkout failed',
  '\tat com.example.Checkout.run(Checkout.java:120)',
  'Caused by: java.io.IOException: Failed to fetch',
  '\tat com.example.Cart.fetch(Cart.java:42)',
].join('\n');

const exceptionRow = (
  language: string | undefined,
  stacktrace: string,
  key = 'exception.stacktrace',
) => ({
  ...(language != null && {
    __hdx_resource_attributes: { 'telemetry.sdk.language': language },
  }),
  __hdx_event_attributes: {
    'exception.type': 'Error',
    'exception.message': 'Checkout failed',
    [key]: stacktrace,
  },
});

describe('RowOverviewPanel exception section', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads exception.* from the row attributes', () => {
    renderRow({
      __hdx_event_attributes: {
        'exception.type': 'TypeError',
        'exception.message': 'x is undefined',
        'exception.stacktrace': 'TypeError: x is undefined\n    at main.js:1',
      },
    });

    expect(exceptionShown()).toMatchObject({
      type: 'TypeError',
      value: 'x is undefined',
      stacktrace: 'TypeError: x is undefined\n    at main.js:1',
    });
  });

  it('passes no stacktrace text when the row has none', () => {
    renderRow({
      __hdx_event_attributes: {
        'exception.type': 'ValueError',
        'exception.message': 'bad input',
      },
    });

    expect(exceptionShown().stacktrace).toEqual([]);
  });

  it('prefers the exception span event over the row attributes', () => {
    renderRow({
      __hdx_event_attributes: { 'exception.type': 'FromAttributes' },
      __hdx_events_exception_attributes: { 'exception.type': 'FromEvent' },
    });

    expect(exceptionShown()).toMatchObject({ type: 'FromEvent' });
  });

  it('parses a JavaScript stack into frames and Caused by sections', () => {
    renderRow(exceptionRow('webjs', CHROME_STACK));

    expect(exceptionValuesShown()).toEqual([
      {
        type: 'Error',
        value: 'Checkout failed',
        mechanism: undefined,
        rawStacktrace: CHROME_STACK,
        stacktrace: {
          frames: [
            {
              filename: 'https://example.clickhouse.com/assets/app.js',
              function: 'checkout',
              lineno: 120,
              colno: 11,
              in_app: true,
            },
          ],
        },
      },
      {
        type: 'TypeError',
        value: 'Failed to fetch',
        stacktrace: {
          frames: [
            {
              filename: 'https://example.clickhouse.com/assets/app.js',
              function: 'fetchCart',
              lineno: 42,
              colno: 9,
              in_app: true,
            },
          ],
        },
      },
    ]);
  });

  it('parses a Node.js exception span event', () => {
    renderRow({
      __hdx_resource_attributes: { 'telemetry.sdk.language': 'nodejs' },
      __hdx_events_exception_attributes: {
        'exception.type': 'Error',
        'exception.stacktrace':
          'Error: boom\n    at handler (/srv/app/dist/server.js:12:9)',
      },
    });

    expect(exceptionShown().stacktrace.frames).toEqual([
      expect.objectContaining({ function: 'handler', lineno: 12, colno: 9 }),
    ]);
  });

  it.each([
    ['a java row with a Java stack', 'java', JAVA_STACK],
    ['a python row', 'python', CHROME_STACK],
    ['a row without resource attributes', undefined, CHROME_STACK],
    ['a webjs row without frames', 'webjs', 'Error: Checkout failed'],
  ])('keeps the raw text for %s', (_, language, stacktrace) => {
    renderRow(exceptionRow(language, stacktrace));

    expect(exceptionValuesShown()).toHaveLength(1);
    expect(exceptionShown().stacktrace).toBe(stacktrace);
    expect(exceptionShown().rawStacktrace).toBeUndefined();
  });

  it('keeps JSON parsed_stacktrace rows unchanged', () => {
    const parsedStacktrace = {
      frames: [
        {
          filename: 'https://example.clickhouse.com/assets/app.js',
          function: 'checkout',
          lineno: 120,
          colno: 11,
          in_app: true,
        },
      ],
    };
    renderRow(
      exceptionRow(
        'webjs',
        JSON.stringify(parsedStacktrace),
        'exception.parsed_stacktrace',
      ),
    );

    expect(exceptionValuesShown()).toEqual([
      {
        type: 'Error',
        value: 'Checkout failed',
        mechanism: undefined,
        stacktrace: parsedStacktrace,
      },
    ]);
  });

  it('hides the section without exception attributes', () => {
    renderRow({
      __hdx_event_attributes: { 'http.request.method': 'GET' },
      __hdx_events_exception_attributes: {},
    });

    expect(mockExceptionSubpanel).not.toHaveBeenCalled();
  });
});
