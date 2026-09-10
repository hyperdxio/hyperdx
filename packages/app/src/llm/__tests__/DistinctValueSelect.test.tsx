import { screen } from '@testing-library/react';

import { makeTraceSource } from '@/llm/__fixtures__/sources';
import { DistinctValueSelect } from '@/llm/dashboard/DistinctValueSelect';

let mockRows: Record<string, unknown>[] | undefined = [];
let mockLoading = false;
jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: () => ({
    data: mockRows == null ? undefined : { data: mockRows },
    isLoading: mockLoading,
    isError: false,
  }),
}));

const TRACE_SOURCE = makeTraceSource();

const baseProps = {
  source: TRACE_SOURCE,
  valueExpression: "SpanAttributes['user.email']",
  gateExpression: '1=1',
  queryKey: 'llm-user-select',
  allLabel: 'All users',
  dateRange: [new Date(0), new Date(1000)] as [Date, Date],
};

describe('DistinctValueSelect', () => {
  beforeEach(() => {
    mockRows = [];
    mockLoading = false;
  });

  it('shows the applied value when it is present in the fetched options', () => {
    mockRows = [{ value: 'alice@x.com' }, { value: 'bob@x.com' }];
    const onChange = jest.fn();
    renderWithMantine(
      <DistinctValueSelect
        {...baseProps}
        value="alice@x.com"
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('combobox')).toHaveValue('alice@x.com');
    expect(onChange).not.toHaveBeenCalled();
  });

  // The charts read the value from the URL, so a control that falls back to
  // its placeholder here would read "All users" over a filtered dashboard —
  // which looks like an unfiltered view returning nothing.
  it('keeps the applied value selected when it is absent from the options', () => {
    mockRows = [{ value: 'bob@x.com' }];
    const onChange = jest.fn();
    renderWithMantine(
      <DistinctValueSelect
        {...baseProps}
        value="alice@x.com"
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('combobox')).toHaveValue('alice@x.com');
    // Clearing the parent here would discard a filter the user still has
    // applied, so absence must never write back.
    expect(onChange).not.toHaveBeenCalled();
  });

  // Deep-linking into a filtered URL renders once before the distinct-value
  // query resolves; the value is not stale then, just not fetched yet.
  it('keeps the applied value selected while the options are still loading', () => {
    mockRows = undefined;
    mockLoading = true;
    const onChange = jest.fn();
    renderWithMantine(
      <DistinctValueSelect
        {...baseProps}
        value="alice@x.com"
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('combobox')).toHaveValue('alice@x.com');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('falls back to the placeholder when no value is applied', () => {
    mockRows = [{ value: 'bob@x.com' }];
    renderWithMantine(
      <DistinctValueSelect {...baseProps} value="" onChange={jest.fn()} />,
    );

    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(screen.getByPlaceholderText('All users')).toBeInTheDocument();
  });
});
