import { Provider } from 'jotai';
import type { ReactElement } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  appendSelectWithAdditionalKeys,
  RawLogTable,
} from '@/components/DBRowTable';
import * as useChartConfigModule from '@/hooks/useChartConfig';
import { RowWhereResult } from '@/hooks/useRowWhere';
import { RowClickAction, UserPreferences } from '@/useUserPreferences';

// The inline expanded row reads the row query params through nuqs, which needs
// a mounted Next router.
jest.mock('nuqs', () => ({
  ...jest.requireActual('nuqs'),
  useQueryState: () => [null, jest.fn()],
}));

const mockRowWhereResult: RowWhereResult = { where: '', aliasWith: [] };

describe('RawLogTable', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(useChartConfigModule, 'useAliasMapFromChartConfig')
      .mockReturnValue({
        data: {},
        isLoading: false,
        error: null,
      } as any);

    // Suppress console errors for expected errors in tests. Keeps the test output clean.
    jest.spyOn(console, 'error').mockImplementation(() => {
      /* noop */
    });
  });

  it('should render no results message when no results found', async () => {
    renderWithMantine(
      <RawLogTable
        displayedColumns={['col1', 'col2']}
        rows={[]}
        isLoading={false}
        dedupRows={false}
        hasNextPage={false}
        onRowDetailsClick={() => {}}
        generateRowId={() => mockRowWhereResult}
        columnTypeMap={new Map()}
      />,
    );

    expect(await screen.findByTestId('db-row-table-no-results')).toBeTruthy();
  });

  describe('Sorting', () => {
    const baseProps = {
      displayedColumns: ['col1', 'col2'],
      rows: [
        {
          col1: 'value1',
          col2: 'value2',
        },
      ],
      isLoading: false,
      dedupRows: false,
      hasNextPage: false,
      onRowDetailsClick: () => {},
      generateRowId: () => mockRowWhereResult,
      columnTypeMap: new Map(),
    };
    it('Should not allow changing sort if disabled', () => {
      renderWithMantine(<RawLogTable {...baseProps} />);

      expect(
        screen.queryByTestId('raw-log-table-sort-button'),
      ).not.toBeInTheDocument();
    });

    it('Should allow changing sort', async () => {
      const callback = jest.fn();

      renderWithMantine(
        <RawLogTable {...baseProps} enableSorting onSortingChange={callback} />,
      );

      const sortElements = await screen.findAllByTestId(
        'raw-log-table-sort-button',
      );
      expect(sortElements).toHaveLength(2);

      await userEvent.click(sortElements.at(0)!);

      expect(callback).toHaveBeenCalledWith([
        {
          desc: false,
          id: 'col1',
        },
      ]);
    });

    it('Should show sort indicator', async () => {
      renderWithMantine(
        <RawLogTable
          {...baseProps}
          enableSorting
          sortOrder={[
            {
              desc: false,
              id: 'col1',
            },
          ]}
        />,
      );

      const sortElements = await screen.findByTestId(
        'raw-log-table-sort-indicator',
      );
      expect(sortElements).toBeInTheDocument();
      expect(sortElements).toHaveClass('sorted-asc');
    });

    it('Should reference alias map when possible', async () => {
      jest
        .spyOn(useChartConfigModule, 'useAliasMapFromChartConfig')
        .mockReturnValue({
          data: {
            col1: 'col1_alias',
            col2: 'col2_alias',
          },
          isLoading: false,
          error: null,
        } as any);

      const callback = jest.fn();
      renderWithMantine(
        <RawLogTable {...baseProps} enableSorting onSortingChange={callback} />,
      );
      const sortElements = await screen.findAllByTestId(
        'raw-log-table-sort-button',
      );
      expect(sortElements).toHaveLength(2);

      await userEvent.click(sortElements.at(0)!);

      expect(callback).toHaveBeenCalledWith([
        {
          desc: false,
          id: '"col1"',
        },
      ]);
    });
  });

  describe('Column width persistence', () => {
    const baseProps = {
      displayedColumns: ['col1', 'col2'],
      rows: [{ col1: 'value1', col2: 'value2' }],
      isLoading: false,
      dedupRows: false,
      hasNextPage: false,
      onRowDetailsClick: () => {},
      generateRowId: () => mockRowWhereResult,
      columnTypeMap: new Map(),
      showExpandButton: false,
    };

    beforeEach(() => {
      window.localStorage.clear();
    });

    it('applies stored column width when tableId is provided', () => {
      // useLocalStorage stringifies under the same key the component reads.
      window.localStorage.setItem(
        't1-column-sizes',
        JSON.stringify({ col1: 250 }),
      );

      const { container } = renderWithMantine(
        <RawLogTable {...baseProps} tableId="t1" />,
      );

      // Two <th> rendered: col1 (non-last, takes stored width) and col2 (last,
      // takes remaining viewport width). Only col1 has a stored size to check.
      const headers = container.querySelectorAll('th');
      expect(headers).toHaveLength(2);
      expect((headers[0] as HTMLElement).style.width).toBe('250px');
    });

    it('isolates stored widths per tableId', () => {
      // A different table's stored widths must not leak into a different
      // scope — this is what guarantees per-saved-search / per-source
      // isolation when widths are persisted across the app.
      window.localStorage.setItem(
        't1-column-sizes',
        JSON.stringify({ col1: 250 }),
      );

      const { container } = renderWithMantine(
        <RawLogTable {...baseProps} tableId="t2" />,
      );

      const headers = container.querySelectorAll('th');
      expect(headers).toHaveLength(2);
      expect((headers[0] as HTMLElement).style.width).not.toBe('250px');
    });
  });

  describe('Row click behavior', () => {
    const ROW_ID = 'Timestamp = 1';
    const VIEWPORT_HEIGHT = 900;

    // The table is virtualized and jsdom performs no layout, so every element
    // measures 0px and the virtualizer renders no rows at all. Fake just enough
    // geometry for one screenful. Same approach as the MetricExplorer tests.
    let rectSpy: jest.SpyInstance;
    let clientHeightSpy: jest.SpyInstance;

    beforeAll(() => {
      rectSpy = jest
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockImplementation(function (this: HTMLElement) {
          const height =
            this.dataset.testid === 'search-results-table'
              ? VIEWPORT_HEIGHT
              : 23;
          return {
            width: 580,
            height,
            top: 0,
            left: 0,
            right: 580,
            bottom: height,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          };
        });
      clientHeightSpy = jest
        .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
        .mockReturnValue(VIEWPORT_HEIGHT);
    });

    afterAll(() => {
      rectSpy.mockRestore();
      clientHeightSpy.mockRestore();
    });

    const baseProps = {
      displayedColumns: ['col1'],
      rows: [{ col1: 'value1' }],
      isLoading: false,
      dedupRows: false,
      hasNextPage: false,
      generateRowId: () => ({ where: ROW_ID, aliasWith: [] }),
      getRowWhere: () => ({ where: ROW_ID, aliasWith: [] }),
      columnTypeMap: new Map(),
      renderRowDetails: () => <div>row details</div>,
    };

    // A fresh jotai store per render keeps the stored preference from leaking
    // into the next test through the module-level preferences atom.
    const renderTable = (ui: ReactElement, rowClickAction?: RowClickAction) => {
      window.localStorage.clear();
      if (rowClickAction) {
        window.localStorage.setItem(
          'hdx-user-preferences',
          JSON.stringify({
            colorMode: 'dark',
            rowClickAction,
          } satisfies Partial<UserPreferences>),
        );
      }
      return renderWithMantine(<Provider>{ui}</Provider>);
    };

    it('opens the side panel on row click by default', async () => {
      const onRowDetailsClick = jest.fn();

      renderTable(
        <RawLogTable {...baseProps} onRowDetailsClick={onRowDetailsClick} />,
      );

      await userEvent.click(
        await screen.findByRole('button', {
          name: 'View details for log entry',
        }),
      );

      expect(onRowDetailsClick).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByTestId(`expanded-row-${ROW_ID}`),
      ).not.toBeInTheDocument();
      // A row click already opens the panel, so the hover button would be a
      // second way to do the same thing.
      expect(
        screen.queryByRole('button', { name: 'Open in side panel' }),
      ).not.toBeInTheDocument();
    });

    it('expands the row inline when its body is clicked', async () => {
      const onRowDetailsClick = jest.fn();

      renderTable(
        <RawLogTable {...baseProps} onRowDetailsClick={onRowDetailsClick} />,
        'expand',
      );

      await userEvent.click(
        await screen.findByRole('button', { name: 'Expand log row' }),
      );

      expect(await screen.findByTestId(`expanded-row-${ROW_ID}`)).toBeVisible();
      expect(onRowDetailsClick).not.toHaveBeenCalled();
    });

    it('collapses an expanded row when its body is clicked again', async () => {
      renderTable(
        <RawLogTable {...baseProps} onRowDetailsClick={() => {}} />,
        'expand',
      );

      await userEvent.click(
        await screen.findByRole('button', { name: 'Expand log row' }),
      );
      await userEvent.click(
        await screen.findByRole('button', { name: 'Collapse log row' }),
      );

      expect(
        screen.queryByTestId(`expanded-row-${ROW_ID}`),
      ).not.toBeInTheDocument();
    });

    it('opens the side panel from the row hover button', async () => {
      const onRowDetailsClick = jest.fn();

      renderTable(
        <RawLogTable {...baseProps} onRowDetailsClick={onRowDetailsClick} />,
        'expand',
      );

      await userEvent.click(
        await screen.findByRole('button', { name: 'Open in side panel' }),
      );

      expect(onRowDetailsClick).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByTestId(`expanded-row-${ROW_ID}`),
      ).not.toBeInTheDocument();
    });

    // The expanded row is rendered by the expand-button column, so tables that
    // hide it have nowhere to put inline details.
    it('opens the side panel on row click when the expand button is hidden', async () => {
      const onRowDetailsClick = jest.fn();

      renderTable(
        <RawLogTable
          {...baseProps}
          showExpandButton={false}
          onRowDetailsClick={onRowDetailsClick}
        />,
        'expand',
      );

      await userEvent.click(
        await screen.findByRole('button', {
          name: 'View details for log entry',
        }),
      );

      expect(onRowDetailsClick).toHaveBeenCalledTimes(1);
    });

    // The ClickHouse dashboard's slow-query list renders inline details with no
    // side panel behind them.
    it('expands inline regardless of the preference when there is no side panel', async () => {
      renderTable(<RawLogTable {...baseProps} />, 'sidePanel');

      const rowBody = await screen.findByRole('button', {
        name: 'Expand log row',
      });
      expect(
        screen.queryByRole('button', { name: 'Open in side panel' }),
      ).not.toBeInTheDocument();

      await userEvent.click(rowBody);

      expect(await screen.findByTestId(`expanded-row-${ROW_ID}`)).toBeVisible();
      // The expanded row's maximize button would only write URL params nothing
      // reads, so it stays hidden here too.
      expect(
        screen.queryByRole('button', { name: 'Open in side panel' }),
      ).not.toBeInTheDocument();
    });

    // With the panel open it stays the active surface, so a row click moves it
    // rather than expanding rows behind it.
    it('moves the open side panel on row click instead of expanding', async () => {
      const onRowDetailsClick = jest.fn();

      renderTable(
        <RawLogTable
          {...baseProps}
          highlightedLineId="some-other-row"
          onRowDetailsClick={onRowDetailsClick}
        />,
        'expand',
      );

      await userEvent.click(
        await screen.findByRole('button', {
          name: 'View details for log entry',
        }),
      );

      expect(onRowDetailsClick).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByTestId(`expanded-row-${ROW_ID}`),
      ).not.toBeInTheDocument();
    });
  });

  describe('Error state', () => {
    const paginationProps = {
      displayedColumns: ['col1'],
      rows: [] as Record<string, any>[],
      isLoading: false,
      dedupRows: false,
      hasNextPage: true,
      onRowDetailsClick: () => {},
      generateRowId: () => mockRowWhereResult,
      columnTypeMap: new Map(),
    };

    it('should not request another page while the query is in an error state', async () => {
      const fetchNextPage = jest.fn();

      renderWithMantine(
        <RawLogTable
          {...paginationProps}
          isError
          error={new Error('Timeout exceeded')}
          fetchNextPage={fetchNextPage}
        />,
      );

      expect(await screen.findByTestId('chart-error-state')).toBeTruthy();
      expect(fetchNextPage).not.toHaveBeenCalled();
    });

    it('should still request another page when there is no error', async () => {
      const fetchNextPage = jest.fn();

      renderWithMantine(
        <RawLogTable {...paginationProps} fetchNextPage={fetchNextPage} />,
      );

      await waitFor(() => expect(fetchNextPage).toHaveBeenCalled());
    });

    // Looking for a highlighted row that has not been loaded yet also advances
    // pages. Both auto-advance paths are active in jsdom, so these two cases
    // pin the highlighted-line guard alongside the scroll one.
    it('should not look for a highlighted row while the query is in an error state', async () => {
      const fetchNextPage = jest.fn();

      renderWithMantine(
        <RawLogTable
          {...paginationProps}
          rows={[{ col1: 'value1' }]}
          highlightedLineId="a-row-that-is-not-loaded"
          isError
          error={new Error('Timeout exceeded')}
          fetchNextPage={fetchNextPage}
        />,
      );

      expect(await screen.findByTestId('chart-error-state')).toBeTruthy();
      expect(fetchNextPage).not.toHaveBeenCalled();
    });

    it('should look for a highlighted row when there is no error', async () => {
      const fetchNextPage = jest.fn();

      renderWithMantine(
        <RawLogTable
          {...paginationProps}
          rows={[{ col1: 'value1' }]}
          highlightedLineId="a-row-that-is-not-loaded"
          fetchNextPage={fetchNextPage}
        />,
      );

      await waitFor(() => expect(fetchNextPage).toHaveBeenCalled());
    });
  });
});

describe('appendSelectWithAdditionalKeys', () => {
  it('should extract columns from partition key with nested function call', () => {
    const result = appendSelectWithAdditionalKeys(
      'col1, col2',
      'id, created_at',
      ' toStartOfInterval(timestamp, toIntervalDay(3))',
    );
    expect(result).toEqual({
      additionalKeysLength: 4,
      select:
        'col1,col2,timestamp,id,created_at,toStartOfInterval(timestamp, toIntervalDay(3))',
    });
  });

  it('should extract no columns from empty primary key and partition key', () => {
    const result = appendSelectWithAdditionalKeys('col1, col2', '', '', []);
    expect(result).toEqual({
      additionalKeysLength: 0,
      select: 'col1,col2',
    });
  });

  it('should extract columns from complex primary key', () => {
    const result = appendSelectWithAdditionalKeys(
      'col1, col2',
      'id, timestamp, toStartOfInterval(timestamp2, toIntervalDay(3))',
      "toStartOfInterval(timestamp, toIntervalDay(3)), date_diff('DAY', col3, col4), now(), toDate(col5 + INTERVAL 1 DAY)",
    );
    expect(result).toEqual({
      additionalKeysLength: 11,
      select:
        "col1,col2,timestamp,col3,col4,col5,id,timestamp2,toStartOfInterval(timestamp, toIntervalDay(3)),date_diff('DAY', col3, col4),now(),toDate(col5 + INTERVAL 1 DAY),toStartOfInterval(timestamp2, toIntervalDay(3))",
    });
  });

  it('should extract map columns', () => {
    const result = appendSelectWithAdditionalKeys(
      'col1, col2',
      `map['key']`,
      `map2['key'], map1['key3 ']`,
    );
    expect(result).toEqual({
      additionalKeysLength: 3,
      select: `col1,col2,map2['key'],map1['key3 '],map['key']`,
    });
  });

  it('should extract map columns', () => {
    const result = appendSelectWithAdditionalKeys(
      'col1, col2',
      ``,
      `map2['key.2']`,
    );
    expect(result).toEqual({
      additionalKeysLength: 1,
      select: `col1,col2,map2['key.2']`,
    });
  });

  it('should extract array columns', () => {
    const result = appendSelectWithAdditionalKeys(
      'col1, col2',
      `array[1]`,
      `array[2], array[3]`,
    );
    expect(result).toEqual({
      additionalKeysLength: 3,
      select: `col1,col2,array[2],array[3],array[1]`,
    });
  });

  it('should extract json columns', () => {
    const result = appendSelectWithAdditionalKeys(
      'col1, col2',
      `json.b`,
      `json.a, json.b.c, toStartOfDay(timestamp, json_2.d)`,
    );
    expect(result).toEqual({
      additionalKeysLength: 6,
      select: `col1,col2,json.a,json.b.c,timestamp,json_2.d,json.b,toStartOfDay(timestamp, json_2.d)`,
    });
  });

  it('should extract json columns with type specifiers', () => {
    const result = appendSelectWithAdditionalKeys(
      'col1, col2',
      `json.b.:Int64`,
      `toStartOfDay(json.a.b.:DateTime)`,
    );
    expect(result).toEqual({
      additionalKeysLength: 4,
      select: `col1,col2,json.a.b,json.b,toStartOfDay(json.a.b.:DateTime),json.b.:Int64`,
    });
  });

  it('should skip json columns with hard-to-parse type specifiers', () => {
    const result = appendSelectWithAdditionalKeys(
      'col1, col2',
      `json.b.:Array(String), col3`,
      ``,
    );
    expect(result).toEqual({
      additionalKeysLength: 2,
      select: `col1,col2,col3,json.b.:Array(String)`,
    });
  });

  it('should skip nested map references', () => {
    const result = appendSelectWithAdditionalKeys(
      'col1, col2',
      `map['key']['key2'], col3`,
      ``,
    );
    expect(result).toEqual({
      additionalKeysLength: 2,
      select: `col1,col2,col3,map['key']['key2']`,
    });
  });

  it('should append extraKeys to string select', () => {
    const result = appendSelectWithAdditionalKeys('col1, col2', 'id', '', [
      '__hdx_id',
    ]);
    expect(result).toEqual({
      additionalKeysLength: 2,
      select: 'col1,col2,id,__hdx_id',
    });
  });

  it('should not duplicate extraKeys already in select', () => {
    const result = appendSelectWithAdditionalKeys('col1, __hdx_id', 'id', '', [
      '__hdx_id',
    ]);
    expect(result).toEqual({
      additionalKeysLength: 1,
      select: 'col1,__hdx_id,id',
    });
  });

  it('should deduplicate extraKeys that overlap with primary/partition keys', () => {
    const result = appendSelectWithAdditionalKeys('col1, col2', 'id', '', [
      'id',
      '__hdx_id',
    ]);
    expect(result).toEqual({
      additionalKeysLength: 2,
      select: 'col1,col2,id,__hdx_id',
    });
  });

  it('should append extraKeys to array-style select', () => {
    const result = appendSelectWithAdditionalKeys(
      [{ valueExpression: 'col1' }, { valueExpression: 'col2' }],
      'id',
      '',
      ['__hdx_id'],
    );
    expect(result).toEqual({
      additionalKeysLength: 2,
      select: [
        { valueExpression: 'col1' },
        { valueExpression: 'col2' },
        { valueExpression: 'id' },
        { valueExpression: '__hdx_id' },
      ],
    });
  });

  // Tests matching the actual ClickHouse schemas in docker/otel-collector/schema/seed/

  it('otel_logs schema: ORDER BY (toStartOfFiveMinutes(Timestamp), ServiceName, Timestamp), PARTITION BY toDate(Timestamp)', () => {
    const result = appendSelectWithAdditionalKeys(
      'Timestamp, ServiceName, SeverityText, Body',
      'toStartOfFiveMinutes(Timestamp), ServiceName, Timestamp',
      'toDate(Timestamp)',
      ['_block_number', '_block_offset'],
    );
    // Raw expressions (toStartOfFiveMinutes(Timestamp), toDate(Timestamp)) are
    // appended alongside bare column references so the row WHERE clause can
    // filter on PK expressions directly.
    // Timestamp and ServiceName are already in select so they aren't added again.
    expect(result).toEqual({
      additionalKeysLength: 4,
      select:
        'Timestamp,ServiceName,SeverityText,Body,toDate(Timestamp),toStartOfFiveMinutes(Timestamp),_block_number,_block_offset',
    });
  });

  it('otel_traces schema: ORDER BY (ServiceName, SpanName, toDateTime(Timestamp)), PARTITION BY toDate(Timestamp)', () => {
    const result = appendSelectWithAdditionalKeys(
      'Timestamp, ServiceName, SpanName, Duration',
      'ServiceName, SpanName, toDateTime(Timestamp)',
      'toDate(Timestamp)',
      ['_block_number', '_block_offset'],
    );
    expect(result).toEqual({
      additionalKeysLength: 4,
      select:
        'Timestamp,ServiceName,SpanName,Duration,toDate(Timestamp),toDateTime(Timestamp),_block_number,_block_offset',
    });
  });

  it('otel_logs schema with __hdx_id after ServiceName in PK', () => {
    // represents some potential hash
    const result = appendSelectWithAdditionalKeys(
      'Timestamp, ServiceName, Body',
      'toStartOfFiveMinutes(Timestamp), ServiceName, __hdx_id, Timestamp',
      'toDate(Timestamp)',
      ['_block_number', '_block_offset'],
    );
    expect(result).toEqual({
      additionalKeysLength: 5,
      select:
        'Timestamp,ServiceName,Body,__hdx_id,toDate(Timestamp),toStartOfFiveMinutes(Timestamp),_block_number,_block_offset',
    });
  });
});
