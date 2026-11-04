import React from 'react';
import { screen } from '@testing-library/react';

import type { HighlightedAttribute } from '@/components/DBHighlightedAttributesList';
import DBRowSidePanelHeader from '@/components/DBRowSidePanelHeader';
import { makeTraceSource } from '@/llm/__fixtures__/sources';

// Stub modules that touch user preferences, AI APIs, or DOM observers; the
// behavior under test is the body-paper visibility logic, not those deps.
jest.mock('@/useUserPreferences', () => ({
  useUserPreferences: jest.fn().mockReturnValue({
    userPreferences: { expandSidebarHeader: false },
    setUserPreference: jest.fn(),
  }),
}));

jest.mock('@/useFormatTime', () => ({
  FormatTime: () => null,
}));

jest.mock('../AISummarizeButton', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../DBHighlightedAttributesList', () => ({
  DBHighlightedAttributesList: ({ attributes }: { attributes: unknown[] }) => (
    <div data-testid="highlighted-attributes">{attributes.length}</div>
  ),
}));

jest.mock('../DBRowSidePanel', () => ({
  RowSidePanelContext: React.createContext({}),
}));

jest.mock('../DrawerUtils', () => ({
  DrawerFullWidthToggle: () => null,
}));

jest.mock('../LogLevel', () => ({
  __esModule: true,
  default: () => null,
}));

describe('DBRowSidePanelHeader: body section (HDX-4373)', () => {
  it('renders the configured body content when bodyConfigured + mainContent are truthy', () => {
    renderWithMantine(
      <DBRowSidePanelHeader
        mainContent="hello world"
        mainContentHeader="Body"
        bodyConfigured
      />,
    );
    expect(screen.queryByText('hello world')).toBeInTheDocument();
    expect(
      screen.queryByText('No body for this event.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('[Empty]')).not.toBeInTheDocument();
  });

  it('renders the softened empty state when body is configured but value is empty', () => {
    renderWithMantine(
      <DBRowSidePanelHeader
        mainContent=""
        mainContentHeader="Body"
        bodyConfigured
      />,
    );
    expect(screen.queryByText('No body for this event.')).toBeInTheDocument();
    expect(screen.queryByText('[Empty]')).not.toBeInTheDocument();
  });

  it('suppresses the body paper entirely when body is not configured on the source', () => {
    renderWithMantine(
      <DBRowSidePanelHeader
        mainContent=""
        mainContentHeader=""
        bodyConfigured={false}
      />,
    );
    expect(
      screen.queryByText('No body for this event.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('[Empty]')).not.toBeInTheDocument();
  });

  it('defaults bodyConfigured to true (back-compat with callers that do not pass it)', () => {
    renderWithMantine(<DBRowSidePanelHeader mainContent="" />);
    expect(screen.queryByText('No body for this event.')).toBeInTheDocument();
  });

  it('drops the empty-state paper when hideEmptyBody is set', () => {
    renderWithMantine(<DBRowSidePanelHeader mainContent="" hideEmptyBody />);
    expect(
      screen.queryByText('No body for this event.'),
    ).not.toBeInTheDocument();
  });

  it('still renders a non-empty body when hideEmptyBody is set', () => {
    renderWithMantine(
      <DBRowSidePanelHeader mainContent="checkout failed" hideEmptyBody />,
    );
    expect(screen.getByText('checkout failed')).toBeInTheDocument();
  });

  it('omits the body paper when the panel title already shows the body', () => {
    renderWithMantine(
      <DBRowSidePanelHeader
        mainContent="GET /checkout"
        mainContentHeader="SpanName"
        bodyShownInTitle
      />,
    );
    expect(screen.queryByText('GET /checkout')).not.toBeInTheDocument();
    expect(screen.queryByText('SpanName')).not.toBeInTheDocument();
    expect(
      screen.queryByText('No body for this event.'),
    ).not.toBeInTheDocument();
  });
});

describe('DBRowSidePanelHeader: highlighted attributes', () => {
  const attribute: HighlightedAttribute = {
    source: makeTraceSource(),
    displayedKey: 'http.method',
    value: 'GET',
    sql: "SpanAttributes['http.method']",
  };

  it('renders the attribute list when there are attributes', () => {
    renderWithMantine(
      <DBRowSidePanelHeader
        mainContent="hello world"
        attributes={[attribute]}
      />,
    );
    expect(screen.getByTestId('highlighted-attributes')).toHaveTextContent('1');
  });

  it('renders nothing for the attribute list when there are none', () => {
    renderWithMantine(
      <DBRowSidePanelHeader mainContent="hello world" attributes={[]} />,
    );
    expect(
      screen.queryByTestId('highlighted-attributes'),
    ).not.toBeInTheDocument();
  });
});
