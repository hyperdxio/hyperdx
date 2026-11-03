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
    expect(screen.getByTestId('search-sort-button')).toHaveAccessibleName(
      'Sort Body asc',
    );
  });

  it('flips the direction from the picker', async () => {
    const { onApply } = renderPopover();
    openPopover();
    fireEvent.click(await screen.findByText('Asc'));
    fireEvent.click(screen.getByTestId('search-sort-button-apply'));
    expect(onApply).toHaveBeenCalledWith('Timestamp ASC');
  });

  it('lists a tuple sort that spans more than one line', async () => {
    const orderBy = '(toDateTime(Timestamp),\n Timestamp) DESC';
    renderPopover({ value: orderBy, defaultValue: orderBy });
    expect(screen.getByTestId('search-sort-button')).toHaveAccessibleName(
      'Sort 2 fields',
    );
    openPopover();
    expect(
      await screen.findByDisplayValue('toDateTime(Timestamp)'),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('Timestamp')).toBeInTheDocument();
    expect(screen.queryByTestId('search-sort-custom')).not.toBeInTheDocument();
  });

  it('lists function calls inside a tuple sort', async () => {
    const orderBy = '(toDateTime(Timestamp), Timestamp) DESC';
    renderPopover({ value: orderBy, defaultValue: orderBy });
    expect(screen.getByTestId('search-sort-button')).toHaveAccessibleName(
      'Sort 2 fields',
    );
    openPopover();
    expect(
      await screen.findByDisplayValue('toDateTime(Timestamp)'),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('Timestamp')).toBeInTheDocument();
    expect(screen.queryByTestId('search-sort-custom')).not.toBeInTheDocument();
  });

  it('lists a backtick-quoted field that contains a comma', async () => {
    const orderBy = '(`a,b`, Timestamp) DESC';
    renderPopover({ value: orderBy, defaultValue: orderBy });
    openPopover();
    expect(await screen.findByDisplayValue('`a,b`')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Timestamp')).toBeInTheDocument();
    expect(screen.queryByTestId('search-sort-custom')).not.toBeInTheDocument();
  });

  it('does not apply an empty sort', async () => {
    const { onApply } = renderPopover({
      value: 'Timestamp DESC',
      defaultValue: 'Body DESC',
    });
    openPopover();
    fireEvent.click(await screen.findByLabelText('Remove Timestamp'));
    expect(screen.getByTestId('search-sort-button-apply')).toBeDisabled();
    fireEvent.click(screen.getByTestId('search-sort-button-apply'));
    expect(onApply).not.toHaveBeenCalled();
  });

  it('opens on the SQL tab for a custom ORDER BY', async () => {
    const custom = 'Timestamp DESC NULLS LAST';
    const { onApply } = renderPopover({ value: custom, defaultValue: custom });
    expect(screen.getByTestId('search-sort-button')).toHaveAccessibleName(
      `Sort ${custom}`,
    );
    openPopover();
    const editor = await screen.findByLabelText('ORDER BY');
    expect(editor).toHaveValue(custom);
    fireEvent.click(screen.getByText('Fields'));
    expect(screen.getByTestId('search-sort-custom')).toBeInTheDocument();
    expect(
      screen.queryByTestId('search-sort-add-input'),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('SQL'));
    fireEvent.change(screen.getByLabelText('ORDER BY'), {
      target: { value: 'Body ASC' },
    });
    fireEvent.click(screen.getByTestId('search-sort-button-apply'));
    expect(onApply).toHaveBeenCalledWith('Body ASC');
  });

  it('shows the source default as the SQL value, not a placeholder', async () => {
    const orderBy = '(TimestampTime, Timestamp) DESC';
    const { onApply } = renderPopover({ value: '', defaultValue: orderBy });
    openPopover();
    fireEvent.click(await screen.findByText('SQL'));
    expect(screen.getByLabelText('ORDER BY')).toHaveValue(orderBy);
    fireEvent.click(screen.getByTestId('search-sort-button-apply'));
    expect(onApply).toHaveBeenCalledWith('');
  });

  it('lists every field of a tuple sort and can add another', async () => {
    const { onApply } = renderPopover({
      value: '',
      defaultValue: '(TimestampTime, Timestamp) DESC',
      fieldOptions: ['Body', 'Timestamp', 'TimestampTime'],
    });
    expect(screen.getByTestId('search-sort-button')).toHaveAccessibleName(
      'Sort 2 fields',
    );
    openPopover();
    expect(
      await screen.findByDisplayValue('TimestampTime'),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('Timestamp')).toBeInTheDocument();

    const addSort = screen.getByPlaceholderText('Add sort');
    fireEvent.change(addSort, {
      target: { value: 'Bo' },
    });
    fireEvent.click(await screen.findByText('Body'));
    expect(addSort).toHaveValue('');
    fireEvent.click(screen.getByTestId('search-sort-button-apply'));
    expect(onApply).toHaveBeenCalledWith(
      'TimestampTime DESC, Timestamp DESC, Body DESC',
    );
  });

  it('keeps separate tuple keys instead of merging them', async () => {
    const orderBy = '(a, b) ASC, (c, d) DESC';
    const { onApply } = renderPopover({
      value: orderBy,
      defaultValue: orderBy,
    });
    expect(screen.getByTestId('search-sort-button')).toHaveAccessibleName(
      'Sort 2 fields',
    );
    openPopover();
    expect(await screen.findByDisplayValue('(a, b)')).toBeInTheDocument();
    expect(screen.getByDisplayValue('(c, d)')).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('Desc')[0]);
    fireEvent.click(screen.getByTestId('search-sort-button-apply'));
    expect(onApply).toHaveBeenCalledWith('(a, b) DESC, (c, d) DESC');
  });

  it('lists every key of a multi-field sort', async () => {
    renderPopover({ value: 'ServiceName ASC, Timestamp DESC' });
    expect(screen.getByTestId('search-sort-button')).toHaveAccessibleName(
      'Sort 2 fields',
    );
    openPopover();
    expect(await screen.findByDisplayValue('ServiceName')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Timestamp')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove ServiceName')).toBeInTheDocument();
  });

  it('resets a changed sort to the source default', async () => {
    const { onApply } = renderPopover({
      value: 'Body ASC',
      defaultValue: 'Timestamp DESC',
    });
    openPopover();
    fireEvent.click(await screen.findByTestId('search-sort-button-reset'));
    expect(await screen.findByDisplayValue('Timestamp')).toBeInTheDocument();
    expect(screen.getByTestId('search-sort-button-reset')).toBeDisabled();
    fireEvent.click(screen.getByTestId('search-sort-button-apply'));
    expect(onApply).toHaveBeenCalledWith('');
  });

  it('does not apply on cancel', async () => {
    const { onApply } = renderPopover();
    openPopover();
    fireEvent.click(await screen.findByText('Asc'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(onApply).not.toHaveBeenCalled();
  });
});
