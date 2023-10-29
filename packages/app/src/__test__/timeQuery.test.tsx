import {
  getLiveTailTimeRange,
  useNewTimeQuery,
  type UseTimeQueryInputType,
  type UseTimeQueryReturnType,
} from '../timeQuery';
import { useRouter } from 'next/router';
import { render } from '@testing-library/react';
import * as React from 'react';
import { useImperativeHandle } from 'react';
import { QueryParamProvider } from 'use-query-params';
import { NextAdapter } from 'next-query-params';
import { TestRouter } from './fixtures';
import { LocationMock } from '@jedmao/location';

// Setting a fixed time of 10/03/23 at 12pm EDT
const INITIAL_DATE_STRING =
  'Tue Oct 03 2023 12:00:00 GMT-0400 (Eastern Daylight Time)';

jest.mock('next/router', () => ({
  useRouter: jest.fn(),
}));

function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryParamProvider adapter={NextAdapter}>{children}</QueryParamProvider>
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

const { location: savedLocation } = window;

describe('useTimeQuery tests', () => {
  let testRouter: TestRouter;
  let locationMock: LocationMock;

  beforeAll(() => {
    // @ts-ignore - This complains because we can only delete optional operands
    delete window.location;
  });

  beforeEach(() => {
    jest.resetAllMocks();
    locationMock = new LocationMock('https://www.hyperdx.io/');
    testRouter = new TestRouter(locationMock);
    window.location = locationMock;

    (useRouter as jest.Mock).mockReturnValue(testRouter);

    jest.useFakeTimers().setSystemTime(new Date(INITIAL_DATE_STRING));
  });

  afterAll(() => {
    window.location = savedLocation;
  });

  it('initializes successfully to a non-UTC time', async () => {
    const timeQueryRef = React.createRef<UseTimeQueryReturnType>();

    render(
      <TestWrapper>
        <TestComponent
          isUTC={false}
          initialTimeRange={getLiveTailTimeRange()}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );

    // The live tail time range is 15 mins
    expect(timeQueryRef.current?.displayedTimeInputValue).toMatchInlineSnapshot(
      `"Oct 3 11:45:00 - Oct 3 12:00:00"`,
    );
  });

  it('initializes successfully to a UTC time', async () => {
    const timeQueryRef = React.createRef<UseTimeQueryReturnType>();

    render(
      <TestWrapper>
        <TestComponent
          isUTC={true}
          initialTimeRange={getLiveTailTimeRange()}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );

    // The live tail time range is 15 mins
    expect(timeQueryRef.current?.displayedTimeInputValue).toMatchInlineSnapshot(
      `"Oct 3 15:45:00 - Oct 3 16:00:00"`,
    );
  });

  it('can be overridden by `tq` url param', async () => {
    const timeQueryRef = React.createRef<UseTimeQueryReturnType>();
    testRouter.replace('/search?tq=Last+4H');

    const { rerender } = render(
      <TestWrapper>
        <TestComponent
          isUTC={false}
          initialTimeRange={getLiveTailTimeRange()}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );
    jest.runAllTimers();

    rerender(
      <TestWrapper>
        <TestComponent
          isUTC={false}
          initialTimeRange={getLiveTailTimeRange()}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );
    jest.runAllTimers();

    // Once the hook runs, it will unset the `tq` param and replace it with
    // a `from` and `to`
    expect(locationMock.searchParams.get('tq')).toBeNull();
    // `From` should be 10/03/23 at 8:00am EDT
    expect(locationMock.searchParams.get('from')).toBe('1696334400000');
    // `To` should be 10/03/23 at 12:00pm EDT
    expect(locationMock.searchParams.get('to')).toBe('1696348800000');
    expect(timeQueryRef.current?.displayedTimeInputValue).toMatchInlineSnapshot(
      `"Oct 3 08:00:00 - Oct 3 12:00:00"`,
    );
  });

  it('browser navigation of from/to qparmas updates the searched time range', async () => {
    const timeQueryRef = React.createRef<UseTimeQueryReturnType>();
    testRouter.setIsReady(false);
    testRouter.replace('/search');

    const result = render(
      <TestWrapper>
        <TestComponent
          initialDisplayValue="Past 1h"
          isUTC={false}
          initialTimeRange={getLiveTailTimeRange()}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );
    jest.runAllTimers();

    testRouter.setIsReady(true);

    result.rerender(
      <TestWrapper>
        <TestComponent
          initialDisplayValue="Past 1h"
          isUTC={false}
          initialTimeRange={getLiveTailTimeRange()}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );

    expect(timeQueryRef.current?.displayedTimeInputValue).toMatchInlineSnapshot(
      `"Past 1h"`,
    );
    expect(timeQueryRef.current?.searchedTimeRange).toMatchInlineSnapshot(`
      Array [
        2023-10-03T15:45:00.000Z,
        2023-10-03T16:00:00.000Z,
      ]
    `);

    // 10/03/23 from 04:00am EDT to 08:00am EDT
    testRouter.replace('/search?from=1696320000000&to=1696334400000');

    result.rerender(
      <TestWrapper>
        <TestComponent
          initialDisplayValue="Past 1h"
          isUTC={false}
          initialTimeRange={getLiveTailTimeRange()}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );

    result.rerender(
      <TestWrapper>
        <TestComponent
          initialDisplayValue="Past 1h"
          isUTC={false}
          initialTimeRange={getLiveTailTimeRange()}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );

    expect(timeQueryRef.current?.displayedTimeInputValue).toMatchInlineSnapshot(
      `"Oct 3 04:00:00 - Oct 3 08:00:00"`,
    );
    expect(timeQueryRef.current?.searchedTimeRange).toMatchInlineSnapshot(`
      Array [
        2023-10-03T08:00:00.000Z,
        2023-10-03T12:00:00.000Z,
      ]
    `);
  });

  it('overrides initial value with async updated `from` and `to` params', async () => {
    const timeQueryRef = React.createRef<UseTimeQueryReturnType>();
    // 10/03/23 from 04:00am EDT to 08:00am EDT
    testRouter.setIsReady(false);
    testRouter.replace('/search');

    const result = render(
      <TestWrapper>
        <TestComponent
          initialDisplayValue="Past 1h"
          isUTC={false}
          initialTimeRange={getLiveTailTimeRange()}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );
    jest.runAllTimers();

    testRouter.replace('/search?from=1696320000000&to=1696334400000');
    testRouter.setIsReady(true);

    result.rerender(
      <TestWrapper>
        <TestComponent
          initialDisplayValue="Past 1h"
          isUTC={false}
          initialTimeRange={getLiveTailTimeRange()}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );

    expect(timeQueryRef.current?.displayedTimeInputValue).toMatchInlineSnapshot(
      `"Oct 3 04:00:00 - Oct 3 08:00:00"`,
    );
    expect(timeQueryRef.current?.searchedTimeRange).toMatchInlineSnapshot(`
      Array [
        2023-10-03T08:00:00.000Z,
        2023-10-03T12:00:00.000Z,
      ]
    `);
  });

  it('accepts `from` and `to` url params', async () => {
    const timeQueryRef = React.createRef<UseTimeQueryReturnType>();
    // 10/03/23 from 04:00am EDT to 08:00am EDT
    testRouter.replace('/search?from=1696320000000&to=1696334400000');

    render(
      <TestWrapper>
        <TestComponent
          isUTC={false}
          initialTimeRange={getLiveTailTimeRange()}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );
    jest.runAllTimers();

    expect(timeQueryRef.current?.displayedTimeInputValue).toMatchInlineSnapshot(
      `"Oct 3 04:00:00 - Oct 3 08:00:00"`,
    );
  });

  it('handles bad input in `from` and `to` url params', async () => {
    const timeQueryRef = React.createRef<UseTimeQueryReturnType>();
    testRouter.replace('/search?from=abc&to=def');

    render(
      <TestWrapper>
        <TestComponent
          isUTC={false}
          initialTimeRange={getLiveTailTimeRange()}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );
    jest.runAllTimers();

    // Should initialize to the initial time range 11:45am - 12:00pm
    expect(timeQueryRef.current?.displayedTimeInputValue).toMatchInlineSnapshot(
      `"Oct 3 11:45:00 - Oct 3 12:00:00"`,
    );
  });

  it('prefers `tq` param over `from` and `to` params', async () => {
    const timeQueryRef = React.createRef<UseTimeQueryReturnType>();
    // 10/03/23 from 04:00am EDT to 08:00am EDT, tq says last 1 hour
    testRouter.replace(
      '/search?from=1696320000000&to=1696334400000&tq=Past+1h',
    );

    const result = render(
      <TestWrapper>
        <TestComponent
          isUTC={false}
          initialTimeRange={getLiveTailTimeRange()}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );
    jest.runAllTimers();

    result.rerender(
      <TestWrapper>
        <TestComponent
          isUTC={false}
          initialTimeRange={getLiveTailTimeRange()}
          ref={timeQueryRef}
        />
      </TestWrapper>,
    );
    jest.runAllTimers();

    // The time range should be the last 1 hour even though the `from` and `to`
    // params are passed in.
    expect(timeQueryRef.current?.displayedTimeInputValue).toMatchInlineSnapshot(
      `"Oct 3 11:00:00 - Oct 3 12:00:00"`,
    );
  });

  it('enables custom display value', async () => {
    const timeQueryRef = React.createRef<UseTimeQueryReturnType>();
    testRouter.replace('/search');
    const initialDisplayValue = 'Live Tail';

    render(
      <TestWrapper>
        <TestComponent
          isUTC={false}
          initialDisplayValue={initialDisplayValue}
          initialTimeRange={getLiveTailTimeRange()}
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
