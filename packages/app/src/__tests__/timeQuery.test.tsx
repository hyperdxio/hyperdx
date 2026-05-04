/* eslint-disable @eslint-react/no-create-ref */
import * as React from 'react';
import { useImperativeHandle } from 'react';
import { useRouter } from 'next/router';
import {
  type OnUrlUpdateFunction,
  withNuqsTestingAdapter,
} from 'nuqs/adapters/testing';
import { act, render } from '@testing-library/react';

import {
  getLiveTailTimeRange,
  useNewTimeQuery,
  type UseTimeQueryInputType,
  type UseTimeQueryReturnType,
} from '../timeQuery';
import { useUserPreferences } from '../useUserPreferences';

// Setting a fixed time of 10/03/23 at 12pm EDT
const INITIAL_DATE_STRING =
  'Tue Oct 03 2023 12:00:00 GMT-0400 (Eastern Daylight Time)';

jest.mock('next/router', () => ({
  useRouter: jest.fn(),
}));

function TestWrapper({
  children,
  isUTC,
}: {
  children: React.ReactNode;
  isUTC?: boolean;
}) {
  const { setUserPreference } = useUserPreferences();

  React.useEffect(() => {
    setUserPreference({ isUTC });
  }, [setUserPreference, isUTC]);
  return <>{children}</>;
}

const TestComponent = React.forwardRef(function Component(
  timeQueryInput: UseTimeQueryInputType,
  ref: React.Ref<UseTimeQueryReturnType>,
) {
  const timeQueryVal = useNewTimeQuery(timeQueryInput);

  useImperativeHandle(ref, () => timeQueryVal);

  return null;
});

function renderTimeQuery({
  isUTC,
  searchParams,
  onUrlUpdate,
  ...props
}: UseTimeQueryInputType & {
  isUTC?: boolean;
  searchParams?: string;
  onUrlUpdate?: OnUrlUpdateFunction;
}) {
  const ref = React.createRef<UseTimeQueryReturnType>();
  const result = render(
    <TestWrapper isUTC={isUTC}>
      <TestComponent {...props} ref={ref} />
    </TestWrapper>,
    {
      wrapper: withNuqsTestingAdapter({
        searchParams,
        onUrlUpdate,
        hasMemory: true,
      }),
    },
  );
  return { ref, ...result };
}

describe('useNewTimeQuery', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ isReady: true });
    jest.useFakeTimers().setSystemTime(new Date(INITIAL_DATE_STRING));
  });

  it('initializes successfully to a non-UTC time', () => {
    const { ref } = renderTimeQuery({
      initialTimeRange: getLiveTailTimeRange(),
    });

    // The live tail time range is 15 mins
    expect(ref.current?.displayedTimeInputValue).toMatchInlineSnapshot(
      `"Oct 3 11:45:00 - Oct 3 12:00:00"`,
    );
  });

  it('initializes successfully to a UTC time', () => {
    const { ref } = renderTimeQuery({
      isUTC: true,
      initialTimeRange: getLiveTailTimeRange(),
    });

    expect(ref.current?.displayedTimeInputValue).toMatchInlineSnapshot(
      `"Oct 3 15:45:00 - Oct 3 16:00:00"`,
    );
  });

  it('accepts `from` and `to` url params', () => {
    // 10/03/23 from 04:00am EDT to 08:00am EDT
    const { ref } = renderTimeQuery({
      initialTimeRange: getLiveTailTimeRange(),
      searchParams: '?from=1696320000000&to=1696334400000',
    });

    expect(ref.current?.displayedTimeInputValue).toMatchInlineSnapshot(
      `"Oct 3 04:00:00 - Oct 3 08:00:00"`,
    );
    expect(ref.current?.searchedTimeRange).toEqual([
      new Date(1696320000000),
      new Date(1696334400000),
    ]);
  });

  it('falls back to initialTimeRange when from/to are unparseable', () => {
    const { ref } = renderTimeQuery({
      initialTimeRange: getLiveTailTimeRange(),
      searchParams: '?from=abc&to=def',
    });

    expect(ref.current?.displayedTimeInputValue).toMatchInlineSnapshot(
      `"Oct 3 11:45:00 - Oct 3 12:00:00"`,
    );
  });

  it('honors `initialDisplayValue` when updateInput is false', () => {
    // Without `updateInput: false`, the hook's effect overwrites the displayed
    // value with the formatted initialTimeRange on mount.
    const { ref } = renderTimeQuery({
      initialDisplayValue: 'Live Tail',
      initialTimeRange: getLiveTailTimeRange(),
      updateInput: false,
    });

    expect(ref.current?.displayedTimeInputValue).toBe('Live Tail');
  });

  it('onSearch writes parsed range to the url', async () => {
    const onUrlUpdate = jest.fn();
    const { ref } = renderTimeQuery({
      initialTimeRange: getLiveTailTimeRange(),
      onUrlUpdate,
    });

    // setQueryStates flushes via setTimeout — advance fake timers to drain it.
    await act(async () => {
      ref.current?.onSearch('Past 1h');
      jest.runAllTimers();
    });

    expect(onUrlUpdate).toHaveBeenCalledTimes(1);
    const params = onUrlUpdate.mock.calls[0][0].searchParams;
    // 'Past 1h' from "now" (Oct 3 12:00 EDT) → 11:00 EDT to 12:00 EDT
    expect(params.get('from')).toBe('1696345200000');
    expect(params.get('to')).toBe('1696348800000');
  });

  it('onTimeRangeSelect writes the explicit range to the url', async () => {
    const onUrlUpdate = jest.fn();
    const { ref } = renderTimeQuery({
      initialTimeRange: getLiveTailTimeRange(),
      onUrlUpdate,
    });

    const start = new Date(1696320000000);
    const end = new Date(1696334400000);
    await act(async () => {
      ref.current?.onTimeRangeSelect(start, end);
      jest.runAllTimers();
    });

    expect(onUrlUpdate).toHaveBeenCalledTimes(1);
    const params = onUrlUpdate.mock.calls[0][0].searchParams;
    expect(params.get('from')).toBe('1696320000000');
    expect(params.get('to')).toBe('1696334400000');
  });
});
