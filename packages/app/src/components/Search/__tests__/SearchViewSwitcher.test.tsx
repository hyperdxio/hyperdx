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
    chartTypesOnly = false,
    onChange = jest.fn(),
  }: {
    value?: SearchView;
    sourceKind?: SourceKind;
    chartTypesOnly?: boolean;
    onChange?: jest.Mock;
  } = {}) {
    renderWithMantine(
      <SearchViewSwitcher
        value={value}
        onChange={onChange}
        sourceKind={sourceKind}
        chartTypesOnly={chartTypesOnly}
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

  it('picks pie from the chart type menu without selecting Charts first', async () => {
    const user = userEvent.setup();
    const onChange = renderSwitcher();

    await user.click(screen.getByRole('button', { name: /Chart as/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Pie' }));
    expect(onChange).toHaveBeenCalledWith('pie');
  });

  it('picks number from the chart type menu', async () => {
    const user = userEvent.setup();
    const onChange = renderSwitcher();

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

  it('keeps naming the chart type the switcher would return to', () => {
    renderSwitcher({ value: 'list' });

    expect(screen.getByTestId('visualize-as-button')).toHaveTextContent(
      'Time series',
    );
  });

  it('hides event views for metric sources', () => {
    renderSwitcher({ sourceKind: SourceKind.Metric, value: 'timeseries' });

    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByTestId('visualize-as-button')).toHaveTextContent(
      'Time series',
    );
  });

  it('hides event views in SQL chart-only mode', () => {
    renderSwitcher({
      sourceKind: SourceKind.Log,
      chartTypesOnly: true,
      value: 'timeseries',
    });

    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});
