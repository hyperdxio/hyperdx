import {
  ADHOC_FILTER_MAX_CONDITIONS,
  AdhocDashboardFilter as AdhocDashboardFilterType,
  AdhocFilterCondition,
} from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AdhocDashboardFilter } from '@/components/AdhocDashboardFilter/AdhocDashboardFilter';
import { useAdhocFilterOptions } from '@/components/AdhocDashboardFilter/useAdhocFilterOptions';

jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}));

jest.mock('@/components/AdhocDashboardFilter/useAdhocFilterOptions', () => ({
  useAdhocFilterOptions: jest.fn(),
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

const addButton = () => screen.getByTestId('adhoc-filter-add-Conditions');

const renderFilter = (
  conditions: AdhocFilterCondition[],
  definition: AdhocDashboardFilterType = filter,
) => {
  const onChange = jest.fn();
  renderWithMantine(
    <AdhocDashboardFilter
      filter={definition}
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
    jest.mocked(useAdhocFilterOptions).mockReturnValue({
      keys: {
        data: ['ServiceName', 'SeverityText'],
        isLoading: false,
        isError: false,
      },
      values: { data: ['api', 'web'], isLoading: false, isError: false },
    });
  });

  it('renders a pill per condition', () => {
    renderFilter([existing, { key: 'Level', operator: '=~', value: '^err' }]);

    const pills = screen.getAllByTestId('adhoc-condition-pill');
    expect(pills[0]).toHaveTextContent('ServiceName != api');
    expect(pills[1]).toHaveTextContent('Level regex ^err');
  });

  it('marks conditions a PromQL filter cannot apply as invalid', () => {
    renderFilter(
      [
        { key: 'job', operator: 'LIKE', value: '%api%' },
        { key: 'env', operator: '=', value: 'prod' },
      ],
      { ...filter, sourceType: 'promql' },
    );

    const pills = screen.getAllByTestId('adhoc-condition-pill');
    expect(pills[0]).toHaveAttribute('data-invalid', 'true');
    expect(pills[1]).not.toHaveAttribute('data-invalid');
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

  it('stops adding conditions at the limit', async () => {
    renderFilter(
      Array.from({ length: ADHOC_FILTER_MAX_CONDITIONS }, (_, i) => ({
        ...existing,
        value: `${i}`,
      })),
    );

    expect(addButton()).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(addButton());
    expect(screen.queryByTestId(`${editorId}-key`)).not.toBeInTheDocument();
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Conditions is full' }),
    );
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

  it('warns instead of applying a value too long for the URL', async () => {
    const onChange = renderFilter([existing]);

    await userEvent.click(screen.getAllByTestId('adhoc-condition-pill')[0]);
    const valueInput = await screen.findByTestId(`${editorId}-value`);
    await userEvent.clear(valueInput);
    await userEvent.click(valueInput);
    await userEvent.paste('x'.repeat(10001));
    await userEvent.click(screen.getByTestId(`${editorId}-apply`));

    expect(onChange).not.toHaveBeenCalled();
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Condition is too long' }),
    );
    expect(valueInput).toBeInTheDocument();
  });

  it('clears every condition', async () => {
    const onChange = renderFilter([existing]);

    await userEvent.click(screen.getByTestId('adhoc-filter-clear-Conditions'));

    expect(onChange).toHaveBeenCalledWith([]);
  });
});
