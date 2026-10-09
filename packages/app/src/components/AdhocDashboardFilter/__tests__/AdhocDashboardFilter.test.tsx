import {
  AdhocDashboardFilter as AdhocDashboardFilterType,
  AdhocFilterCondition,
} from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AdhocDashboardFilter } from '@/components/AdhocDashboardFilter/AdhocDashboardFilter';
import {
  useAdhocFilterKeys,
  useAdhocFilterValues,
} from '@/components/AdhocDashboardFilter/useAdhocFilterOptions';

jest.mock('@/components/AdhocDashboardFilter/useAdhocFilterOptions', () => ({
  useAdhocFilterKeys: jest.fn(),
  useAdhocFilterValues: jest.fn(),
}));

const filter: AdhocDashboardFilterType = {
  id: 'adhoc1',
  type: 'ADHOC',
  name: 'Conditions',
  sourceType: 'sql',
  sources: ['logs'],
  isVariableEnabled: true,
  variableName: 'conds',
};

const dateRange: [Date, Date] = [new Date(0), new Date(1000)];

const existing: AdhocFilterCondition = {
  key: 'ServiceName',
  operator: '!=',
  value: 'api',
};

const editorId = 'adhoc-condition-editor-Conditions';

const renderFilter = (conditions: AdhocFilterCondition[]) => {
  const onChange = jest.fn();
  renderWithMantine(
    <AdhocDashboardFilter
      filter={filter}
      conditions={conditions}
      onChange={onChange}
      dateRange={dateRange}
      effect={{ hasEffect: true, tooltip: '' }}
    />,
  );
  return onChange;
};

describe('AdhocDashboardFilter', () => {
  beforeEach(() => {
    jest.mocked(useAdhocFilterKeys).mockReturnValue({
      data: ['ServiceName', 'SeverityText'],
      keysBySourceId: new Map(),
      isLoading: false,
      isError: false,
    });
    jest.mocked(useAdhocFilterValues).mockReturnValue({
      data: ['api', 'web'],
      isLoading: false,
      isError: false,
    });
  });

  it('renders a pill per condition', () => {
    renderFilter([existing, { key: 'Level', operator: '=~', value: '^err' }]);

    const pills = screen.getAllByTestId('adhoc-condition-pill');
    expect(pills[0]).toHaveTextContent('ServiceName != api');
    expect(pills[1]).toHaveTextContent('Level regex ^err');
  });

  it('removes a condition', async () => {
    const onChange = renderFilter([
      existing,
      { key: 'Level', operator: '=', value: 'error' },
    ]);

    await userEvent.click(
      screen.getAllByRole('button', { name: 'Remove filter' })[0],
    );

    expect(onChange).toHaveBeenCalledWith([
      { key: 'Level', operator: '=', value: 'error' },
    ]);
  });

  it('suggests values once a key is picked', async () => {
    jest.mocked(useAdhocFilterValues).mockImplementation((_filter, key) => ({
      data: key === 'SeverityText' ? ['error', 'warn'] : [],
      isLoading: false,
      isError: false,
    }));
    renderFilter([]);

    await userEvent.click(screen.getByTestId('adhoc-filter-add-Conditions'));
    const valueInput = await screen.findByTestId(`${editorId}-value`);
    await userEvent.click(valueInput);
    expect(
      screen.queryByRole('option', { name: 'error', hidden: true }),
    ).not.toBeInTheDocument();

    await userEvent.type(screen.getByTestId(`${editorId}-key`), 'SeverityText');
    await userEvent.click(valueInput);
    expect(
      await screen.findByRole('option', { name: 'error', hidden: true }),
    ).toBeInTheDocument();
  });

  it('shows an error when key lookup fails', async () => {
    jest.mocked(useAdhocFilterKeys).mockReturnValue({
      data: [],
      keysBySourceId: new Map(),
      isLoading: false,
      isError: true,
    });
    renderFilter([]);

    await userEvent.click(screen.getByTestId('adhoc-filter-add-Conditions'));
    expect(
      await screen.findByText("Couldn't load suggestions"),
    ).toBeInTheDocument();
  });

  it('adds a condition', async () => {
    const onChange = renderFilter([existing]);

    await userEvent.click(screen.getByTestId('adhoc-filter-add-Conditions'));
    await userEvent.type(
      await screen.findByTestId(`${editorId}-key`),
      'SeverityText',
    );
    await userEvent.type(screen.getByTestId(`${editorId}-value`), 'error');
    await userEvent.click(screen.getByTestId(`${editorId}-apply`));

    expect(onChange).toHaveBeenCalledWith([
      existing,
      { key: 'SeverityText', operator: '=', value: 'error' },
    ]);
  });

  it('edits a condition from its pill', async () => {
    const onChange = renderFilter([
      existing,
      { key: 'Level', operator: '=', value: 'error' },
    ]);

    await userEvent.click(screen.getAllByTestId('adhoc-condition-pill')[0]);
    const valueInput = await screen.findByTestId(`${editorId}-value`);
    expect(valueInput).toHaveValue('api');
    await userEvent.clear(valueInput);
    await userEvent.type(valueInput, 'web');
    await userEvent.click(screen.getByTestId(`${editorId}-apply`));

    expect(onChange).toHaveBeenCalledWith([
      { key: 'ServiceName', operator: '!=', value: 'web' },
      { key: 'Level', operator: '=', value: 'error' },
    ]);
  });

  it('clears every condition', async () => {
    const onChange = renderFilter([existing]);

    await userEvent.click(screen.getByTestId('adhoc-filter-clear-Conditions'));

    expect(onChange).toHaveBeenCalledWith([]);
  });
});
