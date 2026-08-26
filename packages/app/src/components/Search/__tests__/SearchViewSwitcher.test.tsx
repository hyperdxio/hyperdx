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

  it('switches to time series when Chart is clicked from Events', async () => {
    const user = userEvent.setup();
    const onChange = renderSwitcher();

    await user.click(screen.getByRole('button', { name: 'Chart' }));

    expect(onChange).toHaveBeenCalledWith('timeseries');
  });

  it('picks pie from Chart as without an extra Chart click', async () => {
    const user = userEvent.setup();
    const onChange = renderSwitcher();

    await user.click(screen.getByRole('button', { name: 'Chart as' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Pie' }));
    expect(onChange).toHaveBeenCalledWith('pie');
  });

  it('picks number from Chart as', async () => {
    const user = userEvent.setup();
    const onChange = renderSwitcher();

    await user.click(screen.getByRole('button', { name: 'Chart as' }));
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

    await user.click(screen.getByRole('button', { name: 'Events' }));
    await user.click(screen.getByRole('button', { name: 'Chart' }));
    expect(onChange).toHaveBeenLastCalledWith('pie');
  });

  it('labels only the active view, leaving the rest icon-only', () => {
    renderSwitcher({ value: 'list' });

    expect(screen.getByRole('button', { name: 'Events' })).toHaveTextContent(
      'Events',
    );
    expect(screen.getByRole('button', { name: 'Chart' })).toHaveTextContent('');
    expect(screen.getByRole('button', { name: 'Patterns' })).toHaveTextContent(
      '',
    );
  });

  it('names the chart type beside the chart segment once a chart is active', () => {
    renderSwitcher({ value: 'pie' });

    expect(screen.getByRole('button', { name: 'Chart' })).toHaveTextContent(
      'Chart',
    );
    expect(screen.getByRole('button', { name: 'Chart as' })).toHaveTextContent(
      'as Pie',
    );
    expect(screen.getByRole('button', { name: 'Events' })).toHaveTextContent(
      '',
    );
  });

  it('hides event views for metric sources and SQL chart-only mode', () => {
    renderSwitcher({ sourceKind: SourceKind.Metric, value: 'timeseries' });
    expect(
      screen.queryByRole('button', { name: 'Events' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chart' })).toBeInTheDocument();
  });

  it('hides event views in SQL chart-only mode', () => {
    renderSwitcher({
      sourceKind: SourceKind.Log,
      chartTypesOnly: true,
      value: 'timeseries',
    });
    expect(
      screen.queryByRole('button', { name: 'Events' }),
    ).not.toBeInTheDocument();
  });
});
