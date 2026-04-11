import { fireEvent, screen, waitFor } from '@testing-library/react';

import AISummarizeButton from '@/components/AISummarizeButton';

const mockJson = jest.fn();
const mockHdxServer = jest.fn((_path: string, _options?: unknown) => ({
  json: mockJson,
}));

jest.mock('@/api', () => ({
  hdxServer: (...args: [string, unknown?]) => mockHdxServer(...args),
  __esModule: true,
  default: {
    useMe: jest.fn(),
  },
}));

const mockedUseMe = jest.requireMock('@/api').default
  .useMe as jest.MockedFunction<
  () => { data: { aiAssistantEnabled: boolean } }
>;

function mockWindowLocation(search: string) {
  const url = `/search${search}`;
  window.history.replaceState({}, '', url);
}

describe('AISummarizeButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockWindowLocation('');
    mockedUseMe.mockReturnValue({ data: { aiAssistantEnabled: true } });
  });

  it('uses default tone when smart mode is disabled', async () => {
    mockJson.mockResolvedValueOnce({
      summary: 'summary text',
      tone: 'default',
      kind: 'event',
    });

    renderWithMantine(
      <AISummarizeButton
        rowData={{
          __hdx_body: 'request failed',
          __hdx_timestamp: '2026-04-10T00:00:00.000Z',
          ServiceName: 'payments',
        }}
        severityText="error"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /summarize/i }));

    await waitFor(() => {
      expect(mockHdxServer).toHaveBeenCalledWith(
        'ai/summarize',
        expect.objectContaining({
          method: 'POST',
          json: expect.objectContaining({
            kind: 'event',
            tone: 'default',
          }),
        }),
      );
    });
  });

  it('shows style selector and persists tone in smart mode', async () => {
    mockWindowLocation('?smart=true');
    mockJson.mockResolvedValue({
      summary: 'summary text',
      tone: 'default',
      kind: 'event',
    });

    renderWithMantine(
      <AISummarizeButton
        rowData={{
          __hdx_body: 'request failed',
          __hdx_timestamp: '2026-04-10T00:00:00.000Z',
          ServiceName: 'payments',
        }}
        severityText="error"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /style: standard/i }));
    fireEvent.click(await screen.findByText(/detective noir/i));

    expect(localStorage.getItem('hdx-ai-summary-tone')).toBe('noir');

    fireEvent.click(screen.getByRole('button', { name: /summarize/i }));

    await waitFor(() => {
      expect(mockHdxServer).toHaveBeenCalledWith(
        'ai/summarize',
        expect.objectContaining({
          method: 'POST',
          json: expect.objectContaining({
            kind: 'event',
            tone: 'noir',
          }),
        }),
      );
    });
  });

  it('shows AI disabled onboarding and skips API call', async () => {
    mockedUseMe.mockReturnValue({ data: { aiAssistantEnabled: false } });

    renderWithMantine(
      <AISummarizeButton
        rowData={{
          __hdx_body: 'request failed',
          __hdx_timestamp: '2026-04-10T00:00:00.000Z',
          ServiceName: 'payments',
        }}
        severityText="error"
      />,
    );

    expect(
      screen.getByText(/AI summary is not enabled for this HyperDX server\./i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /summarize/i }));

    expect(mockHdxServer).not.toHaveBeenCalled();
    expect(screen.getByText(/AI Summary Not Enabled/i)).toBeInTheDocument();
  });

  it('hides summarize after dismissing when AI is disabled', async () => {
    mockedUseMe.mockReturnValue({ data: { aiAssistantEnabled: false } });

    renderWithMantine(
      <AISummarizeButton
        rowData={{
          __hdx_body: 'request failed',
          __hdx_timestamp: '2026-04-10T00:00:00.000Z',
          ServiceName: 'payments',
        }}
        severityText="error"
      />,
    );

    fireEvent.click(
      screen.getAllByRole('button', { name: /don't show again/i })[0],
    );
    expect(screen.queryByRole('button', { name: /summarize/i })).toBeNull();

    renderWithMantine(
      <AISummarizeButton
        rowData={{
          __hdx_body: 'request failed',
          __hdx_timestamp: '2026-04-10T00:00:00.000Z',
          ServiceName: 'payments',
        }}
        severityText="error"
      />,
    );

    expect(screen.queryByRole('button', { name: /summarize/i })).toBeNull();
  });

  it('re-shows summarize when AI becomes enabled after prior dismissal', async () => {
    mockedUseMe.mockReturnValue({ data: { aiAssistantEnabled: false } });

    const { unmount } = renderWithMantine(
      <AISummarizeButton
        rowData={{
          __hdx_body: 'request failed',
          __hdx_timestamp: '2026-04-10T00:00:00.000Z',
          ServiceName: 'payments',
        }}
        severityText="error"
      />,
    );

    fireEvent.click(
      screen.getAllByRole('button', { name: /don't show again/i })[0],
    );
    expect(screen.queryByRole('button', { name: /summarize/i })).toBeNull();

    mockedUseMe.mockReturnValue({ data: { aiAssistantEnabled: true } });
    unmount();
    renderWithMantine(
      <AISummarizeButton
        rowData={{
          __hdx_body: 'request failed',
          __hdx_timestamp: '2026-04-10T00:00:00.000Z',
          ServiceName: 'payments',
        }}
        severityText="error"
      />,
    );

    expect(
      screen.getByRole('button', { name: /summarize/i }),
    ).toBeInTheDocument();
  });
});
