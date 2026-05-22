import { notifications } from '@mantine/notifications';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import SessionSidePanel from '../SessionSidePanel';
import {
  CLIPBOARD_ERROR_MESSAGE,
  copyTextToClipboard,
} from '../utils/clipboard';

jest.mock(
  '../SessionSubpanel',
  () =>
    function MockSessionSubpanel() {
      return <div data-testid="session-subpanel" />;
    },
);

jest.mock('@/hooks/useResizable', () => ({
  __esModule: true,
  default: () => ({
    size: 50,
    setSize: jest.fn(),
    startResize: jest.fn(),
  }),
}));

jest.mock('../utils/clipboard', () => ({
  ...jest.requireActual('../utils/clipboard'),
  copyTextToClipboard: jest.fn(),
}));

const copyTextToClipboardMock = copyTextToClipboard as jest.Mock;
const notificationsShowSpy = jest
  .spyOn(notifications, 'show')
  .mockImplementation(jest.fn());

function renderPanel() {
  return renderWithMantine(
    <SessionSidePanel
      traceSource={{} as any}
      sessionSource={{} as any}
      sessionId="session-1"
      session={
        {
          userEmail: 'user@example.com',
          maxTimestamp: '2026-05-21T10:00:00Z',
          errorCount: '0',
          sessionCount: '12',
        } as any
      }
      dateRange={[
        new Date('2026-05-21T09:00:00Z'),
        new Date('2026-05-21T10:00:00Z'),
      ]}
      onClose={jest.fn()}
    />,
  );
}

describe('SessionSidePanel', () => {
  beforeEach(() => {
    copyTextToClipboardMock.mockResolvedValue(true);
    window.history.pushState(
      {},
      '',
      '/sessions?sessionSource=source-1&from=1&to=2',
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('copies the current session URL when the share button is clicked', async () => {
    renderPanel();

    window.history.pushState(
      {},
      '',
      '/sessions?sessionSource=source-1&from=1&to=2&sid=session-1&sfrom=10&sto=20',
    );

    fireEvent.click(screen.getByRole('button', { name: /share session/i }));

    await waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalledWith(
        'http://localhost/sessions?sessionSource=source-1&from=1&to=2&sid=session-1&sfrom=10&sto=20',
      );
      expect(notificationsShowSpy).toHaveBeenCalledWith({
        color: 'green',
        message: 'Copied link to clipboard',
      });
    });
  });

  it('shows an error notification when copying the session URL fails', async () => {
    copyTextToClipboardMock.mockResolvedValue(false);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /share session/i }));

    await waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalledWith(
        'http://localhost/sessions?sessionSource=source-1&from=1&to=2',
      );
      expect(notificationsShowSpy).toHaveBeenCalledWith({
        color: 'red',
        message: CLIPBOARD_ERROR_MESSAGE,
      });
    });
  });

  it('shows an error notification when the clipboard helper rejects', async () => {
    copyTextToClipboardMock
      .mockRejectedValueOnce(new Error('copy failed'))
      .mockResolvedValueOnce(true);
    renderPanel();

    const shareButton = screen.getByRole('button', { name: /share session/i });
    fireEvent.click(shareButton);

    await waitFor(() => {
      expect(notificationsShowSpy).toHaveBeenCalledWith({
        color: 'red',
        message: CLIPBOARD_ERROR_MESSAGE,
      });
    });

    fireEvent.click(shareButton);

    await waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalledTimes(2);
      expect(notificationsShowSpy).toHaveBeenCalledWith({
        color: 'green',
        message: 'Copied link to clipboard',
      });
    });
  });

  it('ignores duplicate share clicks while copying is still pending', async () => {
    let finishCopy: (copied: boolean) => void = (_copied: boolean): void => {
      throw new Error('copy promise was not created');
    };
    copyTextToClipboardMock.mockImplementation(
      () =>
        new Promise(resolve => {
          finishCopy = resolve;
        }),
    );
    renderPanel();

    const shareButton = screen.getByRole('button', { name: /share session/i });
    fireEvent.click(shareButton);
    fireEvent.click(shareButton);

    expect(copyTextToClipboardMock).toHaveBeenCalledTimes(1);

    finishCopy(true);

    await waitFor(() => {
      expect(notificationsShowSpy).toHaveBeenCalledTimes(1);
      expect(notificationsShowSpy).toHaveBeenCalledWith({
        color: 'green',
        message: 'Copied link to clipboard',
      });
    });

    fireEvent.click(shareButton);

    expect(copyTextToClipboardMock).toHaveBeenCalledTimes(2);

    finishCopy(true);

    await waitFor(() => {
      expect(notificationsShowSpy).toHaveBeenCalledTimes(2);
    });
  });

  it('does not show a share notification after the panel unmounts', async () => {
    let finishCopy: (copied: boolean) => void = (_copied: boolean): void => {
      throw new Error('copy promise was not created');
    };
    copyTextToClipboardMock.mockImplementation(
      () =>
        new Promise(resolve => {
          finishCopy = resolve;
        }),
    );
    const { unmount } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /share session/i }));

    expect(copyTextToClipboardMock).toHaveBeenCalledTimes(1);

    unmount();
    finishCopy(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(notificationsShowSpy).not.toHaveBeenCalled();
  });
});
