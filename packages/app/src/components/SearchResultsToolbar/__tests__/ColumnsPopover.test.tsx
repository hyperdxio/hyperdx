import React from 'react';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ColumnsPopover } from '@/components/SearchResultsToolbar/ColumnsPopover';

jest.mock('@/components/SQLEditor/SQLInlineEditor', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
    label,
  }: {
    value: string;
    onChange: (value: string) => void;
    label: string;
  }) => (
    <input
      aria-label={label}
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  ),
}));

function renderPopover(
  props: Partial<React.ComponentProps<typeof ColumnsPopover>> = {},
) {
  const onApply = jest.fn();
  render(
    <MantineProvider>
      <ColumnsPopover
        value="Timestamp, Body"
        defaultValue="Timestamp, ServiceName, Body"
        fieldOptions={['Body', 'ServiceName', 'SeverityText', 'Timestamp']}
        knownColumns={new Set(['Body', 'ServiceName', 'Timestamp'])}
        onApply={onApply}
        tableConnection={undefined}
        {...props}
      />
    </MantineProvider>,
  );
  return { onApply };
}

const openPopover = () =>
  fireEvent.click(screen.getByTestId('search-columns-button'));

describe('ColumnsPopover', () => {
  it('shows the column count and falls back to the default SELECT', () => {
    renderPopover({ value: '' });
    expect(screen.getByTestId('search-columns-button')).toHaveTextContent(
      'Columns (3)',
    );
  });

  it('removes a column and reports it on apply', async () => {
    const { onApply } = renderPopover();
    openPopover();
    fireEvent.click(await screen.findByLabelText('Remove Body'));
    fireEvent.click(screen.getByTestId('search-columns-button-apply'));
    expect(onApply).toHaveBeenCalledWith('Timestamp', ['Body']);
  });

  it('adds a picked field', async () => {
    const { onApply } = renderPopover();
    openPopover();
    const input = await screen.findByPlaceholderText('Add column');
    fireEvent.change(input, { target: { value: 'Severity' } });
    fireEvent.click(await screen.findByText('SeverityText'));
    fireEvent.click(screen.getByTestId('search-columns-button-apply'));
    expect(onApply).toHaveBeenCalledWith('Timestamp, Body, SeverityText', []);
  });

  it('edits the SELECT on the SQL tab', async () => {
    const { onApply } = renderPopover();
    openPopover();
    fireEvent.click(await screen.findByText('SQL'));
    fireEvent.change(screen.getByLabelText('SELECT'), {
      target: { value: 'count()' },
    });
    fireEvent.click(screen.getByTestId('search-columns-button-apply'));
    expect(onApply).toHaveBeenCalledWith('count()', ['Timestamp', 'Body']);
  });

  it('discards the draft on cancel', async () => {
    const { onApply } = renderPopover();
    openPopover();
    fireEvent.click(await screen.findByLabelText('Remove Body'));
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() =>
      expect(
        screen.queryByTestId('search-columns-button-popover'),
      ).not.toBeInTheDocument(),
    );
    openPopover();
    expect(await screen.findByLabelText('Remove Body')).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });
});
