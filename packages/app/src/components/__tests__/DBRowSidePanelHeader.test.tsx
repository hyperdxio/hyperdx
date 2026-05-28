import React from 'react';
import { screen } from '@testing-library/react';

import DBRowSidePanelHeader from '../DBRowSidePanelHeader';

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
        date={new Date('2026-05-27T12:00:00Z')}
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
        date={new Date('2026-05-27T12:00:00Z')}
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
        date={new Date('2026-05-27T12:00:00Z')}
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
    renderWithMantine(
      <DBRowSidePanelHeader
        date={new Date('2026-05-27T12:00:00Z')}
        mainContent=""
      />,
    );
    expect(screen.queryByText('No body for this event.')).toBeInTheDocument();
  });
});
