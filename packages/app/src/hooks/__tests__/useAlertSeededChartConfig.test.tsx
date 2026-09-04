import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';
import { renderHook } from '@testing-library/react';

import { useAlertSeededChartConfig } from '@/hooks/useAlertSeededChartConfig';

const useAlert = jest.fn();

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useAlert: (id: string | undefined) => useAlert(id),
  },
}));

jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}));

const chartConfig = {
  name: 'Error rate',
  source: 'source-1',
  displayType: DisplayType.Line,
  select: [{ aggFn: 'count' as const, aggCondition: '', valueExpression: '' }],
  where: '',
};

const setChartConfig = jest.fn();
const clearAlertId = jest.fn();

const render = (alertId: string | null) =>
  renderHook(() =>
    useAlertSeededChartConfig({ alertId, setChartConfig, clearAlertId }),
  );

beforeEach(() => {
  jest.clearAllMocks();
  useAlert.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
  });
});

describe('useAlertSeededChartConfig', () => {
  it('does nothing without an alertId', () => {
    const { result } = render(null);

    expect(useAlert).toHaveBeenCalledWith(undefined);
    expect(setChartConfig).not.toHaveBeenCalled();
    expect(clearAlertId).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });

  // The explorer holds the form back while a seed is outstanding: it auto-runs
  // once on mount, so seeding after that would leave a result for the wrong
  // query. Clearing the param is what releases it.
  it('reports an outstanding seed while the alert is in flight', () => {
    useAlert.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    const { result } = render('alert-1');

    expect(result.current).toBe(true);
    expect(setChartConfig).not.toHaveBeenCalled();
    expect(clearAlertId).not.toHaveBeenCalled();
  });

  it('seeds the config and clears the param once resolved', () => {
    useAlert.mockReturnValue({
      data: { data: { _id: 'alert-1', chartConfig } },
      isLoading: false,
      isError: false,
    });

    render('alert-1');

    expect(setChartConfig).toHaveBeenCalledWith(chartConfig);
    expect(clearAlertId).toHaveBeenCalledTimes(1);
  });

  // Clearing the param re-renders with the same resolved data; without the
  // latch the effect would re-seed and overwrite edits made since.
  it('seeds only once per alert', () => {
    useAlert.mockReturnValue({
      data: { data: { _id: 'alert-1', chartConfig } },
      isLoading: false,
      isError: false,
    });

    const { rerender } = render('alert-1');
    rerender();
    rerender();

    expect(setChartConfig).toHaveBeenCalledTimes(1);
  });

  // A saved-search or tile alert carries no config of its own, and a deleted
  // one carries nothing at all.
  it('warns and clears the param when the alert has no config', () => {
    useAlert.mockReturnValue({
      data: { data: { _id: 'alert-1' } },
      isLoading: false,
      isError: false,
    });

    render('alert-1');

    expect(setChartConfig).not.toHaveBeenCalled();
    expect(clearAlertId).toHaveBeenCalledTimes(1);
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Chart unavailable' }),
    );
  });

  it('warns and clears the param when the fetch fails', () => {
    useAlert.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render('alert-1');

    expect(setChartConfig).not.toHaveBeenCalled();
    expect(clearAlertId).toHaveBeenCalledTimes(1);
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({ color: 'yellow' }),
    );
  });
});
