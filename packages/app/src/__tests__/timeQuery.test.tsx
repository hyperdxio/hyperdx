import * as React from 'react';
import { useImperativeHandle } from 'react';
import { useRouter } from 'next/router';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
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
  searchParams,
}: {
  children: React.ReactNode;
  isUTC?: boolean;
  searchParams?: Record<string, string>;
}) {
  const { setUserPreference } = useUserPreferences();

  React.useEffect(() => {
    setUserPreference({ isUTC });
  }, [setUserPreference, isUTC]);

  return (
    <NuqsTestingAdapter searchParams={searchParams}>
      {children}
    </NuqsTestingAdapter>
  );
}

const TestComponent = React.forwardRef(function Component(
  timeQueryInput: UseTimeQueryInputType,
  ref: React.Ref<UseTimeQueryReturnType>,
) {
  const timeQueryVal = useNewTimeQuery(timeQueryInput);

  useImperativeHandle(ref, () => timeQueryVal);

  return null;
});

describe('useNewTimeQuery tests', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ isReady: true });
    jest.useFakeTimers().setSystemTime(new Date(INITIAL_DATE_STRING));
  });

  it('displays initial time range as a formatted string when no url params', async () => {
    const timeQueryRef = React.createRef<UseTimeQueryReturnType>();

    render(
      <TestWrapper>
        <TestComponent
          initialTimeRange={getLiveTailTimeRange()}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );

    // The live tail time range is 15 mins before the fixed time
    expect(timeQueryRef.current?.displayedTimeInputValue).toMatchInlineSnapshot(
      `"Oct 3 11:45:00 - Oct 3 12:00:00"`,
    );
    expect(timeQueryRef.current?.searchedTimeRange).toEqual(
      getLiveTailTimeRange(),
    );
  });

  it('displays initial time range in UTC when isUTC is set', async () => {
    const timeQueryRef = React.createRef<UseTimeQueryReturnType>();

    render(
      <TestWrapper isUTC={true}>
        <TestComponent
          initialTimeRange={getLiveTailTimeRange()}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );

    expect(timeQueryRef.current?.displayedTimeInputValue).toMatchInlineSnapshot(
      `"Oct 3 15:45:00 - Oct 3 16:00:00"`,
    );
  });

  it('accepts `from` and `to` url params and updates searchedTimeRange', async () => {
    const timeQueryRef = React.createRef<UseTimeQueryReturnType>();

    render(
      // 10/03/23 from 04:00am EDT to 08:00am EDT
      <TestWrapper
        searchParams={{ from: '1696320000000', to: '1696334400000' }}
      >
        <TestComponent
          initialTimeRange={getLiveTailTimeRange()}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );
    jest.runAllTimers();

    expect(timeQueryRef.current?.displayedTimeInputValue).toMatchInlineSnapshot(
      `"Oct 3 04:00:00 - Oct 3 08:00:00"`,
    );
    expect(timeQueryRef.current?.searchedTimeRange).toMatchInlineSnapshot(`
      [
        2023-10-03T08:00:00.000Z,
        2023-10-03T12:00:00.000Z,
      ]
    `);
  });

  it('falls back to initialTimeRange when url params are invalid', async () => {
    const timeQueryRef = React.createRef<UseTimeQueryReturnType>();

    render(
      <TestWrapper searchParams={{ from: 'abc', to: 'def' }}>
        <TestComponent
          initialTimeRange={getLiveTailTimeRange()}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );
    jest.runAllTimers();

    // nuqs returns null for invalid integers, so the hook falls back to initialTimeRange
    expect(timeQueryRef.current?.displayedTimeInputValue).toMatchInlineSnapshot(
      `"Oct 3 11:45:00 - Oct 3 12:00:00"`,
    );
    expect(timeQueryRef.current?.searchedTimeRange).toEqual(
      getLiveTailTimeRange(),
    );
  });

  it('does not update displayedTimeInputValue until router is ready', async () => {
    const timeQueryRef = React.createRef<UseTimeQueryReturnType>();
    (useRouter as jest.Mock).mockReturnValue({ isReady: false });

    // Start with no url params and router not ready
    const { rerender } = render(
      <TestWrapper searchParams={{}}>
        <TestComponent
          initialDisplayValue="Past 1h"
          initialTimeRange={getLiveTailTimeRange()}
          showRelativeInterval={true}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );
    jest.runAllTimers();

    // While not ready, displayedTimeInputValue stays at initialDisplayValue
    expect(timeQueryRef.current?.displayedTimeInputValue).toBe('Past 1h');

    // Make router ready — useEffect fires and picks up empty URL params
    (useRouter as jest.Mock).mockReturnValue({ isReady: true });
    rerender(
      <TestWrapper searchParams={{}}>
        <TestComponent
          initialDisplayValue="Past 1h"
          initialTimeRange={getLiveTailTimeRange()}
          showRelativeInterval={true}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );
    jest.runAllTimers();

    // With showRelativeInterval + no params, keeps initialDisplayValue
    expect(timeQueryRef.current?.displayedTimeInputValue).toBe('Past 1h');
    expect(timeQueryRef.current?.searchedTimeRange).toEqual(
      getLiveTailTimeRange(),
    );
  });

  it('updates searchedTimeRange when onTimeRangeSelect is called', async () => {
    const timeQueryRef = React.createRef<UseTimeQueryReturnType>();

    render(
      <TestWrapper>
        <TestComponent
          initialTimeRange={getLiveTailTimeRange()}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );

    // Simulate user selecting a time range
    act(() => {
      timeQueryRef.current?.onTimeRangeSelect(
        // 10/03/23 from 04:00am EDT to 08:00am EDT
        new Date(1696320000000),
        new Date(1696334400000),
      );
    });

    expect(timeQueryRef.current?.displayedTimeInputValue).toMatchInlineSnapshot(
      `"Oct 3 04:00:00 - Oct 3 08:00:00"`,
    );
    expect(timeQueryRef.current?.searchedTimeRange).toMatchInlineSnapshot(`
      [
        2023-10-03T08:00:00.000Z,
        2023-10-03T12:00:00.000Z,
      ]
    `);
  });

  it('preserves initialDisplayValue when showRelativeInterval is set', async () => {
    const timeQueryRef = React.createRef<UseTimeQueryReturnType>();
    const initialDisplayValue = 'Past 1h';

    render(
      <TestWrapper>
        <TestComponent
          initialDisplayValue={initialDisplayValue}
          initialTimeRange={getLiveTailTimeRange()}
          showRelativeInterval={true}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );
    jest.runAllTimers();

    expect(timeQueryRef.current?.displayedTimeInputValue).toBe(
      initialDisplayValue,
    );
  });
});
