import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import AISummarizeButton from '@/components/AISummarizeButton';

const mockJson = jest.fn();
const mockHdxServer = jest.fn(() => ({
  json: mockJson,
}));

jest.mock('@/api', () => ({
  hdxServer: (...args: unknown[]) => mockHdxServer(...args),
}));

function mockWindowLocation(search: string) {
  const url = `/search${search}`;
  window.history.replaceState({}, '', url);
}

describe('AISummarizeButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockWindowLocation('');
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
});
