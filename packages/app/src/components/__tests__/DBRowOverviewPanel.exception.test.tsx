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

const exceptionShown = () =>
  mockExceptionSubpanel.mock.calls[0]?.[0].exceptionValues[0];

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

  it('hides the section without exception attributes', () => {
    renderRow({
      __hdx_event_attributes: { 'http.request.method': 'GET' },
      __hdx_events_exception_attributes: {},
    });

    expect(mockExceptionSubpanel).not.toHaveBeenCalled();
  });
});
