import { SourceKind, TLogSource } from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import {
  browserSpan,
  CLICK_TIMESTAMP,
  clickResult,
  consoleLogRow,
  legacySpan,
  logRows,
  logSource,
  TIMING_TIMESTAMP,
  timingResult,
} from '@/hooks/__fixtures__/browserTraceEvents';
import { useBrowserTraceEvents } from '@/hooks/useBrowserTraceEvents';

const mockUseQueriedChartConfig = jest.fn();
const mockUseFieldExpressionGenerator = jest.fn();

jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: (...args: unknown[]) =>
    mockUseQueriedChartConfig(...args),
}));
jest.mock('@/hooks/useFieldExpressionGenerator', () => ({
  __esModule: true,
  default: (source?: TLogSource) => {
    mockUseFieldExpressionGenerator(source);
    return {
      isLoading: false,
      getFieldExpression: source
        ? (column: string, key: string) => `${column}['${key}']`
        : undefined,
    };
  },
}));

const TIMING = 'TraceResourceTiming';
const TRIGGER = 'TraceTriggerClick';

type Props = Parameters<typeof useBrowserTraceEvents>[0];
type QueryState = { data?: unknown; isError?: boolean };

function setup(
  props: Partial<Props> = {},
  queries: { [TIMING]?: QueryState; [TRIGGER]?: QueryState } = {},
) {
  const states: Record<string, QueryState> = {
    [TIMING]: { data: timingResult, ...queries[TIMING] },
    [TRIGGER]: { data: clickResult, ...queries[TRIGGER] },
  };
  mockUseQueriedChartConfig.mockImplementation(
    (_config: unknown, { queryKeyPrefix }: { queryKeyPrefix: string }) => ({
      isError: false,
      ...states[queryKeyPrefix],
    }),
  );
  const initialProps: Props = {
    traceRows: [browserSpan],
    logRows,
    logSource,
    traceId: 't1',
    foldTimingRows: true,
    enabled: true,
    ...props,
  };
  const hook = renderHook((p: Props) => useBrowserTraceEvents(p), {
    initialProps,
  });
  return { ...hook, initialProps };
}

const lastQuery = (prefix: string) =>
  mockUseQueriedChartConfig.mock.calls.findLast(
    ([, options]) => options.queryKeyPrefix === prefix,
  );
const queriesEnabled = () => ({
  timing: lastQuery(TIMING)?.[1].enabled,
  trigger: lastQuery(TRIGGER)?.[1].enabled,
});

describe('useBrowserTraceEvents', () => {
  beforeEach(() => {
    mockUseQueriedChartConfig.mockReset();
    mockUseFieldExpressionGenerator.mockReset();
  });

  it.each([
    ['legacy SDK spans', { traceRows: [legacySpan] }],
    [
      'a log source without an event name',
      { logSource: { ...logSource, eventNameExpression: undefined } },
    ],
    ['no log source', { logSource: null }],
  ])('sends nothing and returns the rows as given for %s', (_name, props) => {
    const { result, rerender, initialProps } = setup(props);

    expect(queriesEnabled()).toEqual({ timing: false, trigger: false });
    expect(mockUseFieldExpressionGenerator).toHaveBeenLastCalledWith(undefined);
    expect(result.current.triggerRow).toBeUndefined();
    expect(result.current.logRows).toBe(logRows);
    const markers = result.current.resourceTimingBySpanId;
    expect(markers.size).toBe(0);

    rerender({ ...initialProps, traceRows: [...initialProps.traceRows] });
    expect(result.current.resourceTimingBySpanId).toBe(markers);
  });

  it('holds both queries while the trace fetches', () => {
    setup({ enabled: false });

    expect(queriesEnabled()).toEqual({ timing: false, trigger: false });
  });

  it('queries the trace timing logs from the browser spans', () => {
    setup();

    expect(lastQuery(TIMING)).toEqual([
      expect.objectContaining({
        source: 'logs',
        where: "TraceId = 't1'",
        dateRange: [
          new Date('2026-10-22T04:52:37.000Z'),
          new Date('2026-10-22T04:57:37.830Z'),
        ],
      }),
      { enabled: true, queryKeyPrefix: TIMING, staleTime: Infinity },
    ]);
  });

  it("queries the clicks before the first browser span in the span's session", () => {
    setup();

    expect(mockUseFieldExpressionGenerator).toHaveBeenLastCalledWith(logSource);
    expect(lastQuery(TRIGGER)).toEqual([
      expect.objectContaining({
        source: 'logs',
        dateRange: [
          new Date('2026-10-22T04:52:37.000Z'),
          new Date('2026-10-22T04:52:37.818Z'),
        ],
        filters: expect.arrayContaining([
          { type: 'lucene', condition: 'LogAttributes.session.id:"s1"' },
        ]),
      }),
      { enabled: true, queryKeyPrefix: TRIGGER, staleTime: Infinity },
    ]);
  });

  it('shows the click as a row with its log row id', () => {
    const { result } = setup();

    expect(result.current.triggerRow).toEqual({
      Timestamp: CLICK_TIMESTAMP,
      Body: '',
      SpanId: '',
      type: SourceKind.Log,
      id: `Timestamp=parseDateTime64BestEffort('${CLICK_TIMESTAMP}', 9) AND toString(EventName)='browser.user_action.click' AND LogAttributes['session.id']='s1' AND Body=''`,
      aliasWith: [],
      __hdx_hidden: false,
      triggeredBy: 'Triggered by: Clicked testid=checkout · 3ms before',
    });
  });

  it('hides the click row with the span it anchors on', () => {
    const { result } = setup({
      traceRows: [{ ...browserSpan, __hdx_hidden: true }],
    });

    expect(result.current.triggerRow?.__hdx_hidden).toBe(true);
  });

  it('skips the click lookup, metadata included, when the span has no session id', () => {
    const { result } = setup({
      traceRows: [
        {
          ...browserSpan,
          SpanAttributes: {
            'browser.document.url.full': 'http://localhost:5173/',
          },
        },
      ],
    });

    expect(mockUseFieldExpressionGenerator).toHaveBeenLastCalledWith(undefined);
    expect(queriesEnabled()).toEqual({ timing: true, trigger: false });
    expect(result.current.triggerRow).toBeUndefined();
  });

  it('shows no click row when the row id cannot be built', () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const { result } = setup(
      {},
      {
        [TRIGGER]: {
          data: { ...clickResult, meta: clickResult.meta.slice(0, 1) },
        },
      },
    );

    expect(result.current.triggerRow).toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('draws the timing log as dots and folds its row, keeping another log on the span', () => {
    const { result } = setup();

    expect(
      result.current.resourceTimingBySpanId.get('span-1')?.map(m => m.name),
    ).toEqual(['fetchStart', 'responseEnd']);
    expect(result.current.logRows).toEqual([consoleLogRow]);
  });

  it('keeps the timing row while its dots are off screen', () => {
    const { result, rerender, initialProps } = setup({
      foldTimingRows: false,
    });

    expect(result.current.resourceTimingBySpanId.has('span-1')).toBe(true);
    expect(result.current.logRows).toBe(logRows);

    rerender({ ...initialProps, foldTimingRows: true });
    expect(result.current.logRows).toEqual([consoleLogRow]);
  });

  it('changes nothing when the queries fail', () => {
    const { result } = setup(
      {},
      { [TIMING]: { isError: true }, [TRIGGER]: { isError: true } },
    );

    expect(result.current.logRows).toBe(logRows);
    expect(result.current.resourceTimingBySpanId.size).toBe(0);
    expect(result.current.triggerRow).toBeUndefined();
  });

  it('keeps the selected timing row until another row is selected', () => {
    const { result, rerender, initialProps } = setup({
      highlightedRowWhere: 'timing-row',
    });

    expect(result.current.logRows).toEqual(logRows);
    expect(result.current.resourceTimingBySpanId.has('span-1')).toBe(true);

    rerender({ ...initialProps, highlightedRowWhere: 'console-row' });
    expect(result.current.logRows).toEqual([consoleLogRow]);
  });

  it('keeps the timing row the panel was opened from', () => {
    const { result } = setup({
      initialRowHighlightHint: {
        timestamp: TIMING_TIMESTAMP,
        spanId: 'span-1',
        body: '',
      },
    });

    expect(result.current.logRows).toEqual(logRows);
  });
});
