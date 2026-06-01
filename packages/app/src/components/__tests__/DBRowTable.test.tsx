import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  addMapAliasesToSelect,
  appendSelectWithAdditionalKeys,
  RawLogTable,
} from '@/components/DBRowTable';
import { RowWhereResult } from '@/hooks/useRowWhere';

import * as useChartConfigModule from '../../hooks/useChartConfig';

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

describe('addMapAliasesToSelect', () => {
  it('leaves plain columns unchanged and collapses ", " to ","', () => {
    expect(addMapAliasesToSelect('Timestamp, ServiceName, SeverityText')).toBe(
      'Timestamp,ServiceName,SeverityText',
    );
  });

  it('aliases a single-quoted bracket-form map key', () => {
    expect(addMapAliasesToSelect("ResourceAttributes['service.name']")).toBe(
      `ResourceAttributes['service.name'] as "ResourceAttributes['service.name']"`,
    );
  });

  it('aliases only the map keys in a mixed multi-column input', () => {
    expect(
      addMapAliasesToSelect(
        "Timestamp, ResourceAttributes['service.name'], SeverityText",
      ),
    ).toBe(
      `Timestamp,ResourceAttributes['service.name'] as "ResourceAttributes['service.name']",SeverityText`,
    );
  });

  it('preserves function-call expressions whose arguments contain commas', () => {
    expect(
      addMapAliasesToSelect(
        "Timestamp, toDateTime(now64(3, 'UTC')), ServiceName",
      ),
    ).toBe(`Timestamp,toDateTime(now64(3, 'UTC')),ServiceName`);
  });

  it('aliases an arrayElement(Col, key) Map subscript', () => {
    expect(
      addMapAliasesToSelect("arrayElement(ResourceAttributes, 'service.name')"),
    ).toBe(
      `arrayElement(ResourceAttributes, 'service.name') as "ResourceAttributes['service.name']"`,
    );
  });

  it('passes already-aliased plain columns through unchanged', () => {
    expect(addMapAliasesToSelect('Timestamp as ts, ServiceName as svc')).toBe(
      'Timestamp as ts,ServiceName as svc',
    );
  });

  it('does NOT re-alias a bracket-form map subscript that already carries an "as <alias>" clause', () => {
    expect(
      addMapAliasesToSelect("ResourceAttributes['service.name'] as svc"),
    ).toBe("ResourceAttributes['service.name'] as svc");
  });

  it('does NOT re-alias an already-aliased map subscript within a multi-column input', () => {
    expect(
      addMapAliasesToSelect(
        "Timestamp, ResourceAttributes['service.name'] as svc, SeverityText",
      ),
    ).toBe("Timestamp,ResourceAttributes['service.name'] as svc,SeverityText");
  });

  it('does NOT alias unbracketed dot-notation tokens', () => {
    expect(addMapAliasesToSelect('user_data.name')).toBe('user_data.name');
    expect(addMapAliasesToSelect('user_data.address.city')).toBe(
      'user_data.address.city',
    );
  });

  it('does NOT alias multi-segment dotted native columns', () => {
    expect(addMapAliasesToSelect('SpanAttributes.k8s.resource.name')).toBe(
      'SpanAttributes.k8s.resource.name',
    );
  });

  it('does NOT alias toString(x).y attribute-access expressions', () => {
    expect(addMapAliasesToSelect('toString(SpanAttributes).k8s')).toBe(
      'toString(SpanAttributes).k8s',
    );
  });

  it('does NOT alias backtick-quoted dotted JSON paths', () => {
    expect(addMapAliasesToSelect('`host`.`arch`')).toBe('`host`.`arch`');
  });

  it('returns an empty string for empty input', () => {
    expect(addMapAliasesToSelect('')).toBe('');
  });
});
