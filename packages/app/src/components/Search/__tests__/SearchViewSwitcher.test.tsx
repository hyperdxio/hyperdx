import { useState } from 'react';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { SearchView } from '@/components/Search/searchViews';
import { SearchViewSwitcher } from '@/components/Search/SearchViewSwitcher';

describe('SearchViewSwitcher', () => {
  function renderSwitcher({
    value = 'list',
    sourceKind = SourceKind.Log,
    sqlMode = false,
    onChange = jest.fn(),
  }: {
    value?: SearchView;
    sourceKind?: SourceKind;
    sqlMode?: boolean;
    onChange?: jest.Mock;
  } = {}) {
    renderWithMantine(
      <SearchViewSwitcher
        value={value}
        onChange={onChange}
        sourceKind={sourceKind}
        sqlMode={sqlMode}
      />,
    );
    return onChange;
  }

  it('switches to time series when Charts is selected from Events', async () => {
    const user = userEvent.setup();
    const onChange = renderSwitcher();

    await user.click(screen.getByRole('radio', { name: 'Charts' }));

    expect(onChange).toHaveBeenCalledWith('timeseries');
  });

  it('picks pie from the chart type menu', async () => {
    const user = userEvent.setup();
    const onChange = renderSwitcher({ value: 'timeseries' });

    await user.click(screen.getByRole('button', { name: /Chart as/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Pie' }));
    expect(onChange).toHaveBeenCalledWith('pie');
  });

  it('picks number from the chart type menu', async () => {
    const user = userEvent.setup();
    const onChange = renderSwitcher({ value: 'timeseries' });

    await user.click(screen.getByRole('button', { name: /Chart as/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Number' }));
    expect(onChange).toHaveBeenCalledWith('number');
  });

  it('returns to the last chart type after switching back to Events', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    function Harness() {
      const [value, setValue] = useState<SearchView>('pie');
      return (
        <SearchViewSwitcher
          value={value}
          onChange={next => {
            onChange(next);
            setValue(next);
          }}
          sourceKind={SourceKind.Log}
        />
      );
    }

    renderWithMantine(<Harness />);

    await user.click(screen.getByRole('radio', { name: 'Events' }));
    await user.click(screen.getByRole('radio', { name: 'Charts' }));
    expect(onChange).toHaveBeenLastCalledWith('pie');
  });

  it('labels only the active segment, leaving the rest icon-only', () => {
    renderSwitcher({ value: 'list' });

    expect(screen.getByRole('radio', { name: 'Events' })).toBeChecked();
    // The inactive segments keep their names for screen readers, but the text
    // is visually hidden so the row only pays for one label.
    expect(screen.getByRole('radio', { name: 'Charts' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Patterns' })).not.toBeChecked();
  });

  it('names the current chart type in the As control', () => {
    renderSwitcher({ value: 'pie' });

    expect(screen.getByRole('radio', { name: 'Charts' })).toBeChecked();
    expect(screen.getByTestId('visualize-as-button')).toHaveTextContent('Pie');
  });

  it('withholds the As control until a chart is on screen', () => {
    renderSwitcher({ value: 'list' });

    expect(screen.queryByTestId('visualize-as-button')).not.toBeInTheDocument();
  });

  it('brings the As control back with the chart it belongs to', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [value, setValue] = useState<SearchView>('list');
      return (
        <SearchViewSwitcher
          value={value}
          onChange={setValue}
          sourceKind={SourceKind.Log}
        />
      );
    }

    renderWithMantine(<Harness />);
    expect(screen.queryByTestId('visualize-as-button')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Charts' }));

    expect(screen.getByTestId('visualize-as-button')).toHaveTextContent(
      'Time series',
    );
  });

  it('offers Browse instead of the event views for metric sources', async () => {
    const user = userEvent.setup();
    const onChange = renderSwitcher({
      sourceKind: SourceKind.Metric,
      value: 'timeseries',
    });

    expect(
      screen.queryByRole('radio', { name: 'Events' }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('visualize-as-button')).toHaveTextContent(
      'Time series',
    );

    await user.click(screen.getByRole('radio', { name: 'Browse' }));
    expect(onChange).toHaveBeenCalledWith('browse');
  });

  it('keeps Browse to metric sources', () => {
    renderSwitcher({ sourceKind: SourceKind.Log });

    expect(
      screen.queryByRole('radio', { name: 'Browse' }),
    ).not.toBeInTheDocument();
  });

  it('keeps Events but drops heatmap and patterns in SQL mode', async () => {
    const user = userEvent.setup();
    const onChange = renderSwitcher({ sqlMode: true, value: 'timeseries' });

    await user.click(screen.getByRole('radio', { name: 'Events' }));

    expect(onChange).toHaveBeenCalledWith('list');
    expect(
      screen.queryByRole('menuitem', { name: /pattern|delta/i }),
    ).not.toBeInTheDocument();
  });

  it('offers chart types in SQL mode from the List view', async () => {
    const user = userEvent.setup();
    const onChange = renderSwitcher({ sqlMode: true, value: 'list' });

    await user.click(screen.getByRole('radio', { name: 'Charts' }));

    expect(onChange).toHaveBeenCalledWith('timeseries');
  });
});
