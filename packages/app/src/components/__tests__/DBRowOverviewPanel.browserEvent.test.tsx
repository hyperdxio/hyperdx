import React from 'react';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { screen, within } from '@testing-library/react';

import { RowOverviewPanel } from '@/components/DBRowOverviewPanel';

let mockRow: Record<string, unknown>;
jest.mock('../DBRowDataPanel', () => ({
  useRowData: () => ({ data: { data: [mockRow] } }),
  getJSONColumnNames: () => [],
  getMapColumnNames: () => [],
}));

jest.mock('../NetworkPropertyPanel', () => ({
  NetworkPropertySubpanel: () => null,
}));

jest.mock('../ExceptionSubpanel', () => ({ ExceptionSubpanel: () => null }));

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
  bodyExpression: 'Body',
});
const TRACE_SOURCE = asSource({
  kind: SourceKind.Trace,
  eventAttributesExpression: 'SpanAttributes',
});

const PAGE_URL = 'http://localhost:5173/';
const SELECTOR =
  '#root > main > section.card.p-4:nth-child(2) > button.btn.btn-primary';
const CLICK_ATTRIBUTES = {
  'browser.tag_name': 'BUTTON',
  'browser.css_selector': SELECTOR,
  'browser.document.url.full': PAGE_URL,
  'browser.element.attributes.testid': 'checkout',
};

function renderRow(
  attributes: Record<string, unknown>,
  row: Record<string, unknown>,
  source = LOG_SOURCE,
) {
  mockRow = { __hdx_body: '', __hdx_event_attributes: attributes, ...row };
  renderWithMantine(<RowOverviewPanel source={source} rowId="row-1" />);
}

const section = () => screen.getByTestId('browser-event-section');
const expectDetail = (label: string, value: string) =>
  expect(
    within(section()).getByRole('row', { name: `${label} ${value}` }),
  ).toBeInTheDocument();
const noBodyPaper = () => screen.queryByText('No body for this event.');

describe('RowOverviewPanel browser event section', () => {
  it('summarizes a click and hides the empty body', () => {
    renderRow(CLICK_ATTRIBUTES, {
      __hdx_event_name: 'browser.user_action.click',
    });

    expect(within(section()).getByText('Browser event')).toBeInTheDocument();
    expectDetail('Element', 'button');
    expectDetail('CSS selector', SELECTOR);
    expectDetail('data-otel-testid', 'checkout');
    expectDetail('Page URL', PAGE_URL);
    expect(noBodyPaper()).not.toBeInTheDocument();
  });

  it('shows a navigation instead of an HTTP request', () => {
    renderRow(
      {
        'url.full': `${PAGE_URL}checkout`,
        'browser.navigation.same_document': 'false',
        'browser.navigation.hash_change': 'false',
      },
      { __hdx_event_name: 'browser.navigation' },
    );

    expectDetail('URL', `${PAGE_URL}checkout`);
    expectDetail('Same document', 'No');
    expectDetail('Hash change', 'No');
    expect(screen.queryByText('HTTP Request')).not.toBeInTheDocument();
  });

  it('reads navigation flags from a JSON column', () => {
    renderRow(
      {
        'browser.navigation.same_document': true,
        'browser.navigation.hash_change': false,
        'browser.navigation.type': 'push',
      },
      { __hdx_event_name: 'browser.navigation' },
    );

    expectDetail('Navigation type', 'push');
    expectDetail('Same document', 'Yes');
    expectDetail('Hash change', 'No');
  });

  it('shows the console method and the first line of the message', () => {
    renderRow(
      { 'browser.console.method': 'log' },
      {
        __hdx_event_name: 'browser.console',
        __hdx_body: 'Checkout started\nstep 2',
      },
    );

    expectDetail('Method', 'log');
    expectDetail('Message', 'Checkout started');
    expect(screen.getByText('Checkout started step 2')).toBeInTheDocument();
  });

  it('finds a click by its attributes when the row has no event name', () => {
    renderRow(CLICK_ATTRIBUTES, {});

    expectDetail('Element', 'button');
    expect(noBodyPaper()).not.toBeInTheDocument();
  });

  it('keeps the HTTP request on a resource timing row', () => {
    renderRow(
      { 'url.full': `${PAGE_URL}assets/app.js` },
      { __hdx_event_name: 'browser.resource_timing' },
    );

    expect(screen.getByText('HTTP Request')).toBeInTheDocument();
    expect(
      screen.queryByTestId('browser-event-section'),
    ).not.toBeInTheDocument();
    expect(noBodyPaper()).not.toBeInTheDocument();
  });

  it('keeps the exception section and the empty body on an exception', () => {
    renderRow(
      { 'exception.type': 'TypeError', 'exception.message': 'x is undefined' },
      { __hdx_event_name: 'exception' },
    );

    expect(screen.getByText('Exception')).toBeInTheDocument();
    expect(
      screen.queryByTestId('browser-event-section'),
    ).not.toBeInTheDocument();
    expect(noBodyPaper()).toBeInTheDocument();
  });

  it('shows no section on a trace row', () => {
    renderRow(CLICK_ATTRIBUTES, {}, TRACE_SOURCE);

    expect(
      screen.queryByTestId('browser-event-section'),
    ).not.toBeInTheDocument();
  });
});
