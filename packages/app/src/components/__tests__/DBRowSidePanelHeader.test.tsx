import React from 'react';
import { screen } from '@testing-library/react';

import DBRowSidePanelHeader from '@/components/DBRowSidePanelHeader';

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
  DBHighlightedAttributesList: () => null,
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
});

describe('DBRowSidePanelHeader: body loading state (HDX-5442)', () => {
  it('renders a loading placeholder instead of the empty state while the row is fetching', () => {
    renderWithMantine(
      <DBRowSidePanelHeader
        mainContent=""
        mainContentHeader="Body"
        bodyConfigured
        isLoading
      />,
    );
    expect(screen.getByTestId('side-panel-body-loading')).toBeInTheDocument();
    expect(
      screen.queryByText('No body for this event.'),
    ).not.toBeInTheDocument();
  });

  it('keeps the body paper suppressed while loading when body is not configured', () => {
    renderWithMantine(
      <DBRowSidePanelHeader
        mainContent=""
        mainContentHeader=""
        bodyConfigured={false}
        isLoading
      />,
    );
    expect(
      screen.queryByTestId('side-panel-body-loading'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('No body for this event.'),
    ).not.toBeInTheDocument();
  });

  it('renders the body rather than the loading placeholder when content arrived mid-refetch', () => {
    renderWithMantine(
      <DBRowSidePanelHeader
        mainContent="hello world"
        mainContentHeader="Body"
        bodyConfigured
        isLoading
      />,
    );
    expect(screen.queryByText('hello world')).toBeInTheDocument();
    expect(
      screen.queryByTestId('side-panel-body-loading'),
    ).not.toBeInTheDocument();
  });

  it('falls through to the empty state once loading settles with no body', () => {
    renderWithMantine(
      <DBRowSidePanelHeader
        mainContent=""
        mainContentHeader="Body"
        bodyConfigured
        isLoading={false}
      />,
    );
    expect(screen.queryByText('No body for this event.')).toBeInTheDocument();
    expect(
      screen.queryByTestId('side-panel-body-loading'),
    ).not.toBeInTheDocument();
  });
});
