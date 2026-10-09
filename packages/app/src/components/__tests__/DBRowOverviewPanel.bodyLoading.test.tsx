import React from 'react';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

const mockUseRowData = jest.fn();
jest.mock('../DBRowDataPanel', () => ({
  __esModule: true,
  useRowData: (args: unknown) => mockUseRowData(args),
  getJSONColumnNames: () => [],
  getMapColumnNames: () => [],
}));

jest.mock('../DBRowSidePanel', () => {
  const { createContext } = jest.requireActual('react');
  return {
    __esModule: true,
    RowSidePanelContext: createContext({}),
  };
});

jest.mock('../DBRowJsonViewer', () => ({
  __esModule: true,
  DBRowJsonViewer: () => null,
}));
jest.mock('../AISummarizeButton', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../DBHighlightedAttributesList', () => ({
  __esModule: true,
  DBHighlightedAttributesList: () => null,
}));
jest.mock('../EventTag', () => ({ __esModule: true, default: () => null }));
jest.mock('../ExceptionSubpanel', () => ({
  __esModule: true,
  ExceptionSubpanel: () => null,
}));
jest.mock('../NetworkPropertyPanel', () => ({
  __esModule: true,
  NetworkPropertySubpanel: () => null,
}));
jest.mock('../SpanEventsSubpanel', () => ({
  __esModule: true,
  SpanEventsSubpanel: () => null,
}));
jest.mock('../SpanLinksSubpanel', () => ({
  __esModule: true,
  getValidSpanLinks: () => [],
  SpanLinksSubpanel: () => null,
}));
jest.mock('../SpanLinkedFromSubpanel', () => ({
  __esModule: true,
  SpanLinkedFromSubpanel: () => null,
}));
jest.mock('../linkedSpans', () => ({
  __esModule: true,
  useReverseSpanLinks: () => ({ links: [] }),
  useLinkedSpanDetails: () => ({ details: new Map() }),
}));

jest.mock('@/source', () => ({
  __esModule: true,
  getEventBody: () => 'Body',
}));
jest.mock('@/utils/highlightedAttributes', () => ({
  __esModule: true,
  getHighlightedAttributesFromData: () => [],
}));
jest.mock('@/utils/rowTimestamps', () => ({
  __esModule: true,
  resolveRowTimestampAnchor: () => undefined,
}));
jest.mock('@/useUserPreferences', () => ({
  useUserPreferences: jest.fn().mockReturnValue({
    userPreferences: { expandSidebarHeader: false },
    setUserPreference: jest.fn(),
  }),
}));

import { RowOverviewPanel } from '@/components/DBRowOverviewPanel';

const LOG_SOURCE: TSource = {
  id: 'log-src',
  name: 'Logs',
  kind: SourceKind.Log,
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, Body',
};

describe('RowOverviewPanel body loading state (HDX-5442)', () => {
  beforeEach(() => {
    mockUseRowData.mockReset();
  });

  it('shows the loading placeholder, not the empty-body copy, while the row is fetching', () => {
    mockUseRowData.mockReturnValue({ data: undefined, isLoading: true });

    renderWithMantine(<RowOverviewPanel source={LOG_SOURCE} rowId="Id='1'" />);

    expect(screen.getByTestId('side-panel-body-loading')).toBeInTheDocument();
    expect(
      screen.queryByText('No body for this event.'),
    ).not.toBeInTheDocument();
  });

  it('shows the empty-body copy once the row has loaded without a body', () => {
    mockUseRowData.mockReturnValue({
      data: { data: [{}], meta: [] },
      isLoading: false,
    });

    renderWithMantine(<RowOverviewPanel source={LOG_SOURCE} rowId="Id='1'" />);

    expect(screen.getByText('No body for this event.')).toBeInTheDocument();
    expect(
      screen.queryByTestId('side-panel-body-loading'),
    ).not.toBeInTheDocument();
  });

  it('renders the body once loaded', () => {
    mockUseRowData.mockReturnValue({
      data: { data: [{ __hdx_body: 'request completed' }], meta: [] },
      isLoading: false,
    });

    renderWithMantine(<RowOverviewPanel source={LOG_SOURCE} rowId="Id='1'" />);

    expect(screen.getByText('request completed')).toBeInTheDocument();
    expect(
      screen.queryByText('No body for this event.'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('side-panel-body-loading'),
    ).not.toBeInTheDocument();
  });
});
