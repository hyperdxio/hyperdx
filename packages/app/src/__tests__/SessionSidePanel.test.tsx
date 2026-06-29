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

jest.mock('nuqs', () => {
  const actual = jest.requireActual('nuqs');
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const noop = () => {};
  return {
    ...actual,
    // eslint-disable-next-line @eslint-react/no-unnecessary-use-prefix
    useQueryState: () => [null, noop],
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
