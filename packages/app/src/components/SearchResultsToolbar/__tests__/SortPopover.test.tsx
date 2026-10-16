import React from 'react';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';

import { SortPopover } from '@/components/SearchResultsToolbar/SortPopover';

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
  props: Partial<React.ComponentProps<typeof SortPopover>> = {},
) {
  const onApply = jest.fn();
  render(
    <MantineProvider>
      <SortPopover
        value="Timestamp DESC"
        defaultValue="Timestamp DESC"
        fieldOptions={['Body', 'Timestamp']}
        onApply={onApply}
        tableConnection={undefined}
        {...props}
      />
    </MantineProvider>,
  );
  return { onApply };
}

const openPopover = () =>
  fireEvent.click(screen.getByTestId('search-sort-button'));

describe('SortPopover', () => {
  it('labels the button with the parsed field and direction', () => {
    renderPopover({ value: 'Body ASC' });
    expect(screen.getByTestId('search-sort-button')).toHaveTextContent(
      'Sort: Body asc',
    );
  });

  it('flips the direction from the picker', async () => {
    const { onApply } = renderPopover();
    openPopover();
    fireEvent.click(await screen.findByText('Asc'));
    fireEvent.click(screen.getByTestId('search-sort-button-apply'));
    expect(onApply).toHaveBeenCalledWith('Timestamp ASC');
  });

  it('opens on the SQL tab for a custom ORDER BY', async () => {
    const custom = '(TimestampTime, Timestamp) DESC';
    const { onApply } = renderPopover({ value: custom, defaultValue: custom });
    expect(screen.getByTestId('search-sort-button')).toHaveTextContent(
      /^Sort$/,
    );
    openPopover();
    const editor = await screen.findByLabelText('ORDER BY');
    expect(editor).toHaveValue(custom);
    fireEvent.change(editor, { target: { value: 'Body ASC' } });
    fireEvent.click(screen.getByTestId('search-sort-button-apply'));
    expect(onApply).toHaveBeenCalledWith('Body ASC');
  });

  it('treats a multi-key ORDER BY as custom', () => {
    renderPopover({ value: 'ServiceName ASC, Timestamp DESC' });
    expect(screen.getByTestId('search-sort-button')).toHaveTextContent(
      /^Sort$/,
    );
  });

  it('does not apply on cancel', async () => {
    const { onApply } = renderPopover();
    openPopover();
    fireEvent.click(await screen.findByText('Asc'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(onApply).not.toHaveBeenCalled();
  });
});
