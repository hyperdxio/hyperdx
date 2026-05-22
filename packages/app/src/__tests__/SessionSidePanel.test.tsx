import { StrictMode } from 'react';
import {
  SourceKind,
  TSessionSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { Session } from '../sessions';
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

const copyTextToClipboardMock = jest.mocked(copyTextToClipboard);
const notificationsShowSpy = jest
  .spyOn(notifications, 'show')
  .mockImplementation(jest.fn());

const traceSource = {
  id: 'trace-source',
  name: 'Trace Source',
  kind: SourceKind.Trace,
  connection: 'clickhouse',
  from: {
    databaseName: 'default',
    tableName: 'traces',
  },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: '*',
  durationExpression: 'Duration',
  durationPrecision: 9,
  traceIdExpression: 'TraceId',
  spanIdExpression: 'SpanId',
  parentSpanIdExpression: 'ParentSpanId',
  spanNameExpression: 'SpanName',
  spanKindExpression: 'SpanKind',
} satisfies TTraceSource;

const sessionSource = {
  id: 'session-source',
  name: 'Session Source',
  kind: SourceKind.Session,
  connection: 'clickhouse',
  from: {
    databaseName: 'default',
    tableName: 'sessions',
  },
  timestampValueExpression: 'Timestamp',
  traceSourceId: traceSource.id,
} satisfies TSessionSource;

const session = {
  userEmail: 'user@example.com',
  maxTimestamp: '2026-05-21T10:00:00Z',
  minTimestamp: '2026-05-21T09:00:00Z',
  errorCount: '0',
  interactionCount: '0',
  recordingCount: '0',
  serviceName: 'web',
  sessionCount: '12',
  sessionId: 'session-1',
  teamId: 'team-1',
  teamName: 'Team',
  userName: 'User',
} satisfies Session;

function renderPanel({ strict = false }: { strict?: boolean } = {}) {
  const panel = (
    <SessionSidePanel
      traceSource={traceSource}
      sessionSource={sessionSource}
      sessionId="session-1"
      session={session}
      dateRange={[
        new Date('2026-05-21T09:00:00Z'),
        new Date('2026-05-21T10:00:00Z'),
      ]}
      onClose={jest.fn()}
    />
  );

  return renderWithMantine(strict ? <StrictMode>{panel}</StrictMode> : panel);
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

    window.history.pushState(
      {},
      '',
      '/sessions?sessionSource=source-1&from=1&to=2&sid=session-1&sfrom=30&sto=40',
    );

    fireEvent.click(screen.getByRole('button', { name: /share session/i }));

    await waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenLastCalledWith(
        'http://localhost/sessions?sessionSource=source-1&from=1&to=2&sid=session-1&sfrom=30&sto=40',
      );
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
    expect(shareButton).toHaveAttribute('data-loading', 'true');

    finishCopy(true);

    await waitFor(() => {
      expect(shareButton).not.toHaveAttribute('data-loading');
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

  it('shows share notifications when rendered in StrictMode', async () => {
    renderPanel({ strict: true });

    fireEvent.click(screen.getByRole('button', { name: /share session/i }));

    await waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalledTimes(1);
      expect(notificationsShowSpy).toHaveBeenCalledWith({
        color: 'green',
        message: 'Copied link to clipboard',
      });
    });
  });
});
