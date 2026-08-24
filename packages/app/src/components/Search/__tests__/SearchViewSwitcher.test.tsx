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

  it('switches to time series when Visualize is clicked from List', async () => {
    const user = userEvent.setup();
    const onChange = renderSwitcher();

    await user.click(screen.getByRole('button', { name: 'Visualize' }));

    expect(onChange).toHaveBeenCalledWith('timeseries');
  });

  it('picks pie from Visualize as without an extra Visualize click', async () => {
    const user = userEvent.setup();
    const onChange = renderSwitcher();

    await user.click(screen.getByRole('button', { name: 'Visualize as' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Pie' }));
    expect(onChange).toHaveBeenCalledWith('pie');
  });

  it('picks number from Visualize as', async () => {
    const user = userEvent.setup();
    const onChange = renderSwitcher();

    await user.click(screen.getByRole('button', { name: 'Visualize as' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Number' }));
    expect(onChange).toHaveBeenCalledWith('number');
  });

  it('returns to the last chart type after switching back to List', async () => {
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

    await user.click(screen.getByRole('button', { name: 'List' }));
    await user.click(screen.getByRole('button', { name: 'Visualize' }));
    expect(onChange).toHaveBeenLastCalledWith('pie');
  });

  it('hides event views for metric sources and SQL chart-only mode', () => {
    renderSwitcher({ sourceKind: SourceKind.Metric, value: 'timeseries' });
    expect(
      screen.queryByRole('button', { name: 'List' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Visualize' }),
    ).toBeInTheDocument();
  });

  it('hides event views in SQL chart-only mode', () => {
    renderSwitcher({
      sourceKind: SourceKind.Log,
      chartTypesOnly: true,
      value: 'timeseries',
    });
    expect(
      screen.queryByRole('button', { name: 'List' }),
    ).not.toBeInTheDocument();
  });
});
