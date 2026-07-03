import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import SessionSidePanel from '@/SessionSidePanel';
import {
  CLIPBOARD_ERROR_MESSAGE,
  copyTextToClipboard,
} from '@/utils/clipboard';

jest.mock('../SessionSubpanel', () => ({
  __esModule: true,
  default: () => <div data-testid="session-subpanel-mock" />,
}));

jest.mock('@/components/DBRowSidePanel', () => {
  const ReactActual = jest.requireActual('react');
  return {
    __esModule: true,
    DBRowSidePanelInner: (props: { rowId: string }) => (
      <div data-testid="event-view-mock">{props.rowId}</div>
    ),
    RowSidePanelContext: ReactActual.createContext({}),
  };
});

// Controllable state for the `sessionPanelEvent` query param so tests can
// simulate a value left in the URL by a previously selected session.
const mockNuqs: {
  sessionPanelEvent: unknown;
  setSessionPanelEvent: jest.Mock;
} = {
  sessionPanelEvent: null,
  setSessionPanelEvent: jest.fn(),
};

jest.mock('nuqs', () => {
  const actual = jest.requireActual('nuqs');
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const noop = () => {};
  return {
    ...actual,
    // eslint-disable-next-line @eslint-react/no-unnecessary-use-prefix
    useQueryState: (key: string) =>
      key === 'sessionPanelEvent'
        ? [mockNuqs.sessionPanelEvent, mockNuqs.setSessionPanelEvent]
        : [null, noop],
  };
});

jest.mock('../utils/clipboard', () => ({
  __esModule: true,
  CLIPBOARD_ERROR_MESSAGE:
    'Could not access the clipboard. Check browser permissions or use HTTPS.',
  copyTextToClipboard: jest.fn(),
}));

jest.mock('@mantine/notifications', () => {
  const actual = jest.requireActual('@mantine/notifications');
  return {
    ...actual,
    notifications: {
      ...actual.notifications,
      show: jest.fn(),
    },
  };
});

const mockedCopy = copyTextToClipboard as jest.MockedFunction<
  typeof copyTextToClipboard
>;
const mockedShow = notifications.show as jest.MockedFunction<
  typeof notifications.show
>;

function setLocationHref(url: string) {
  const parsed = new URL(url, 'http://localhost');
  window.history.replaceState(null, '', parsed.pathname + parsed.search);
}

function renderPanel() {
  return render(
    <MantineProvider>
      <Notifications />
      <SessionSidePanel
        traceSource={{ id: 'trace-source' } as any}
        sessionSource={{ id: 'session-source' } as any}
        sessionId="sid-abc"
        session={
          {
            sessionId: 'sid-abc',
            userEmail: 'user@example.com',
            minTimestamp: '2024-01-01T00:00:00Z',
            maxTimestamp: '2024-01-01T01:00:00Z',
            errorCount: '0',
            sessionCount: '5',
          } as any
        }
        dateRange={[new Date(0), new Date(1)]}
        onClose={jest.fn()}
      />
    </MantineProvider>,
  );
}

describe('SessionSidePanel - Share Session', () => {
  beforeEach(() => {
    mockedCopy.mockReset();
    mockedShow.mockReset();
    mockNuqs.sessionPanelEvent = null;
    mockNuqs.setSessionPanelEvent.mockReset();
    setLocationHref('/sessions?sessionSource=src&from=1&to=2');
  });

  it('copies the URL as it exists at click time, not at render time', async () => {
    mockedCopy.mockResolvedValue(true);

    renderPanel();

    setLocationHref(
      '/sessions?sessionSource=src&from=1&to=2&sid=abc&sfrom=10&sto=20',
    );

    fireEvent.click(screen.getByRole('button', { name: /share session/i }));

    await waitFor(() => expect(mockedCopy).toHaveBeenCalledTimes(1));
    expect(mockedCopy).toHaveBeenCalledWith(
      'http://localhost/sessions?sessionSource=src&from=1&to=2&sid=abc&sfrom=10&sto=20',
    );

    await waitFor(() => expect(mockedShow).toHaveBeenCalledTimes(1));
    expect(mockedShow).toHaveBeenCalledWith(
      expect.objectContaining({
        color: 'green',
        message: 'Copied link to clipboard',
      }),
    );
  });

  it('shows an error notification when the clipboard copy fails', async () => {
    mockedCopy.mockResolvedValue(false);

    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /share session/i }));

    await waitFor(() => expect(mockedShow).toHaveBeenCalledTimes(1));
    expect(mockedShow).toHaveBeenCalledWith(
      expect.objectContaining({
        color: 'red',
        message: CLIPBOARD_ERROR_MESSAGE,
      }),
    );
  });
});

describe('SessionSidePanel - persisted event session ownership', () => {
  beforeEach(() => {
    mockNuqs.sessionPanelEvent = null;
    mockNuqs.setSessionPanelEvent.mockReset();
    setLocationHref('/sessions?sessionSource=src&from=1&to=2');
  });

  it('renders a persisted event that belongs to the current session', () => {
    mockNuqs.sessionPanelEvent = {
      rowId: 'row-current',
      aliasWith: [],
      sessionId: 'sid-abc',
    };

    renderPanel();

    // The event view is shown and the param is left untouched.
    expect(screen.getByTestId('event-view-mock')).toHaveTextContent(
      'row-current',
    );
    expect(
      screen.queryByTestId('session-subpanel-mock'),
    ).not.toBeInTheDocument();
    expect(mockNuqs.setSessionPanelEvent).not.toHaveBeenCalled();
  });

  it('ignores a persisted event owned by a different session', () => {
    // Simulates: opened an event in another session, then clicked this session
    // card (which only updates sid/sfrom/sto and remounts the drawer).
    mockNuqs.sessionPanelEvent = {
      rowId: 'row-stale',
      aliasWith: [],
      sessionId: 'some-other-session',
    };

    renderPanel();

    // The stale event must NOT render inside the newly selected session; the
    // read-time ownership gate falls back to the session root. Correctness does
    // not depend on any evict effect firing, so the param may harmlessly linger
    // in the URL (it can never render for the wrong session).
    expect(screen.getByTestId('session-subpanel-mock')).toBeInTheDocument();
    expect(screen.queryByTestId('event-view-mock')).not.toBeInTheDocument();
  });
});
