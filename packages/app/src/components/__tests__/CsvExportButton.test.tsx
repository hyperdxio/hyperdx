import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { CsvExportButton } from '@/components/CsvExportButton';

const downloadTextFile = jest.fn();
jest.mock('@/utils/downloadFile', () => ({
  downloadTextFile: (...args: unknown[]) => downloadTextFile(...args),
}));

const DATA = [{ level: 'error', count: 2 }];

describe('CsvExportButton', () => {
  beforeEach(() => jest.clearAllMocks());

  it('downloads CSV with the UTF-8 BOM and csv mime type', () => {
    render(
      <CsvExportButton data={DATA} filename="events">
        Export
      </CsvExportButton>,
    );

    fireEvent.click(screen.getByText('Export'));

    expect(downloadTextFile).toHaveBeenCalledTimes(1);
    const [content, filename, mimeType] = downloadTextFile.mock.calls[0];
    // The BOM is what makes Excel read the file as UTF-8 — losing it silently
    // mojibakes every non-ASCII export.
    expect(content.charCodeAt(0)).toBe(0xfeff);
    expect(content).toContain('level');
    expect(filename).toBe('events.csv');
    expect(mimeType).toBe('text/csv;charset=utf-8;');
  });

  it('accepts a filename function', () => {
    render(
      <CsvExportButton data={DATA} filename={() => 'dynamic'}>
        Export
      </CsvExportButton>,
    );

    fireEvent.click(screen.getByText('Export'));

    expect(downloadTextFile.mock.calls[0][1]).toBe('dynamic.csv');
  });

  // With no rows the component renders a non-interactive div rather than a
  // button, so the click never reaches the handler at all.
  it('renders as non-interactive and downloads nothing when there is no data', () => {
    render(
      <CsvExportButton data={[]} filename="events">
        Export
      </CsvExportButton>,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByTitle('No data to export')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Export'));

    expect(downloadTextFile).not.toHaveBeenCalled();
  });
});
