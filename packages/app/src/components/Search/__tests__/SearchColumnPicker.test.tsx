import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SearchColumnPicker } from '@/components/Search/SearchColumnPicker';
import { makeLogSource } from '@/llm/__fixtures__/sources';

jest.mock('@/hooks/useMetadata', () => ({
  useColumns: jest.fn(() => ({
    data: [{ name: 'Timestamp' }, { name: 'Body' }, { name: 'ServiceName' }],
    isLoading: false,
  })),
  useJsonColumns: jest.fn(() => ({ data: [] })),
  useMapColumns: jest.fn(() => ({ data: ['LogAttributes'] })),
  useMultipleAllFields: jest.fn(() => ({
    data: [
      { path: ['Body'], type: 'String', jsType: 'string' },
      { path: ['LogAttributes', 'user.id'], type: 'String', jsType: 'string' },
    ],
    isLoading: false,
  })),
}));

const source = makeLogSource();

describe('SearchColumnPicker', () => {
  it('shows the column count on the button', () => {
    renderWithMantine(
      <SearchColumnPicker
        source={source}
        selectedColumns={['Timestamp', 'Body']}
        onApply={jest.fn()}
      />,
    );

    expect(screen.getByTestId('search-column-picker')).toHaveTextContent(
      'Columns2',
    );
  });

  it('lists columns and map sub-keys, and applies several at once', async () => {
    const onApply = jest.fn();
    renderWithMantine(
      <SearchColumnPicker
        source={source}
        selectedColumns={['Timestamp']}
        onApply={onApply}
      />,
    );

    await userEvent.click(screen.getByTestId('search-column-picker'));
    await userEvent.click(await screen.findByLabelText('ServiceName'));
    await userEvent.click(screen.getByLabelText("LogAttributes['user.id']"));
    expect(onApply).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText('Apply'));

    expect(onApply).toHaveBeenCalledWith([
      'Timestamp',
      'ServiceName',
      "LogAttributes['user.id']",
    ]);
  });

  it('discards an unapplied draft when reopened', async () => {
    renderWithMantine(
      <SearchColumnPicker
        source={source}
        selectedColumns={['Timestamp']}
        onApply={jest.fn()}
      />,
    );

    const trigger = screen.getByTestId('search-column-picker');
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByLabelText('Body'));
    await userEvent.click(trigger);
    await userEvent.click(trigger);

    expect(await screen.findByLabelText('Body')).not.toBeChecked();
    expect(screen.getByLabelText('Timestamp')).toBeChecked();
  });

  it('filters the list by search', async () => {
    renderWithMantine(
      <SearchColumnPicker
        source={source}
        selectedColumns={[]}
        onApply={jest.fn()}
      />,
    );

    await userEvent.click(screen.getByTestId('search-column-picker'));
    await userEvent.type(
      await screen.findByPlaceholderText('Search fields'),
      'serv',
    );

    expect(screen.getByLabelText('ServiceName')).toBeInTheDocument();
    expect(screen.queryByLabelText('Body')).not.toBeInTheDocument();
  });

  it('does not open while disabled', async () => {
    renderWithMantine(
      <SearchColumnPicker
        source={source}
        selectedColumns={['Timestamp']}
        onApply={jest.fn()}
        disabled
        disabledReason="Turn off Advanced to change columns"
      />,
    );

    const trigger = screen.getByTestId('search-column-picker');
    expect(trigger).toBeDisabled();
    await userEvent.click(trigger);
    expect(
      screen.queryByTestId('search-column-picker-dropdown'),
    ).not.toBeInTheDocument();
  });
});
