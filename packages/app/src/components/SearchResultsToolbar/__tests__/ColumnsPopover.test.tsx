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
    expect(screen.getByTestId('search-columns-button')).toHaveAccessibleName(
      'Columns 3 fields',
    );
  });

  it('offers a drag handle for each column', async () => {
    renderPopover();
    openPopover();
    expect(
      await screen.findByLabelText('Reorder Timestamp'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Reorder Body')).toBeInTheDocument();
  });

  it('stays empty after the last column is removed', async () => {
    const { onApply } = renderPopover({
      value: 'Timestamp',
      defaultValue: 'Timestamp, ServiceName, Body',
    });
    openPopover();
    fireEvent.click(await screen.findByLabelText('Remove Timestamp'));
    expect(screen.getByText('No columns selected.')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Remove ServiceName'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('search-columns-button-apply')).toBeDisabled();
    fireEvent.click(screen.getByTestId('search-columns-button-apply'));
    expect(onApply).not.toHaveBeenCalled();

    const input = screen.getByPlaceholderText('Search columns');
    fireEvent.change(input, { target: { value: 'Body' } });
    fireEvent.click(screen.getByTestId('search-columns-add-button'));
    expect(screen.getByLabelText('Remove Body')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Remove ServiceName'),
    ).not.toBeInTheDocument();
  });

  it('keeps a backtick-quoted name when another column is removed', async () => {
    const { onApply } = renderPopover({
      value: 'Timestamp, `a,b`, Body',
      defaultValue: 'Timestamp',
    });
    openPopover();
    fireEvent.click(await screen.findByLabelText('Remove Body'));
    expect(screen.getByLabelText('Remove `a,b`')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('search-columns-button-apply'));
    expect(onApply).toHaveBeenCalledWith('Timestamp, `a,b`', ['Body']);
  });

  it('removes one copy when the same column is listed twice', async () => {
    const { onApply } = renderPopover({
      value: 'Body, Body',
      defaultValue: 'Timestamp',
    });
    openPopover();
    const removes = await screen.findAllByLabelText('Remove Body');
    fireEvent.click(removes[0]);
    expect(screen.getAllByLabelText('Remove Body')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('search-columns-button-apply'));
    expect(onApply).toHaveBeenCalledWith('Body', []);
  });

  it('does not add a map key that is already selected under its alias', async () => {
    const column = `LogAttributes['x'] AS "x"`;
    renderPopover({
      value: column,
      defaultValue: 'Timestamp',
      fieldOptions: ["LogAttributes['x']", 'Body'],
      knownColumns: new Set(['Body']),
    });
    openPopover();
    const input = await screen.findByPlaceholderText('Search columns');
    fireEvent.change(input, { target: { value: "LogAttributes['x']" } });
    expect(
      screen.queryByRole('option', { name: "LogAttributes['x']" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('search-columns-add-button'));
    expect(screen.getAllByLabelText(`Remove ${column}`)).toHaveLength(1);
  });

  it('removes a column and reports it on apply', async () => {
    const { onApply } = renderPopover();
    openPopover();
    fireEvent.click(await screen.findByLabelText('Remove Body'));
    fireEvent.click(screen.getByTestId('search-columns-button-apply'));
    expect(onApply).toHaveBeenCalledWith('Timestamp', ['Body']);
  });

  it('leaves a typed map subscript unchanged', async () => {
    renderPopover({
      fieldOptions: ["LogAttributes['region']"],
    });
    openPopover();
    const input = await screen.findByPlaceholderText('Search columns');
    fireEvent.change(input, {
      target: { value: "LogAttributes['region']" },
    });
    expect(input).toHaveValue("LogAttributes['region']");
  });

  it('shows a map key alias in the input before adding it', async () => {
    renderPopover({
      fieldOptions: ["LogAttributes['ads.consent_given']"],
    });
    openPopover();
    const input = await screen.findByPlaceholderText('Search columns');
    fireEvent.change(input, {
      target: { value: "LogAttributes['ads" },
    });
    fireEvent.click(
      await screen.findByText("LogAttributes['ads.consent_given']"),
    );
    expect(input).toHaveValue(
      `LogAttributes['ads.consent_given'] AS "ads.consent_given"`,
    );
    fireEvent.click(screen.getByTestId('search-columns-add-button'));
    expect(input).toHaveValue('');
    expect(
      screen.getByText(
        `LogAttributes['ads.consent_given'] AS "ads.consent_given"`,
      ),
    ).toBeInTheDocument();
  });

  it('fills the input from a suggestion and adds only on Add', async () => {
    const { onApply } = renderPopover();
    openPopover();
    const input = await screen.findByPlaceholderText('Search columns');
    fireEvent.change(input, { target: { value: 'Severity' } });
    fireEvent.click(await screen.findByText('SeverityText'));
    expect(input).toHaveValue('SeverityText');
    expect(
      screen.queryByLabelText('Remove SeverityText'),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('search-columns-add-button'));
    expect(input).toHaveValue('');
    expect(screen.getByLabelText('Remove SeverityText')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('search-columns-button-apply'));
    expect(onApply).toHaveBeenCalledWith('Timestamp, Body, SeverityText', []);
  });

  it('adds a typed expression such as an alias', async () => {
    const { onApply } = renderPopover();
    openPopover();
    const input = await screen.findByPlaceholderText('Search columns');
    fireEvent.change(input, {
      target: { value: 'upper(Body) as message' },
    });
    fireEvent.click(screen.getByTestId('search-columns-add-button'));
    expect(input).toHaveValue('');
    expect(
      screen.getByLabelText('Remove upper(Body) as message'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('search-columns-button-apply'));
    expect(onApply).toHaveBeenCalledWith(
      'Timestamp, Body, upper(Body) as message',
      [],
    );
  });

  it('resets a changed column list to the source default', async () => {
    const { onApply } = renderPopover();
    openPopover();
    fireEvent.click(await screen.findByLabelText('Remove Body'));
    fireEvent.click(screen.getByTestId('search-columns-button-reset'));
    expect(screen.getByLabelText('Remove ServiceName')).toBeInTheDocument();
    expect(screen.getByTestId('search-columns-button-reset')).toBeDisabled();
    fireEvent.click(screen.getByTestId('search-columns-button-apply'));
    expect(onApply).toHaveBeenCalledWith('', []);
  });

  it('shows the default SELECT as the SQL value', async () => {
    renderPopover({ value: '' });
    openPopover();
    expect(
      await screen.findByTestId('search-columns-button-reset'),
    ).toBeDisabled();
    fireEvent.click(await screen.findByText('SQL'));
    expect(screen.getByLabelText('SELECT')).toHaveValue(
      'Timestamp, ServiceName, Body',
    );
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
